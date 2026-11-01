// routes/order.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const Joi = require('joi');
const { getIO } = require('../socket'); // emit realtime events

// Helper to upsert a customer (by phone) and optionally enforce consent
async function upsertCustomer({ name, phone, consentGiven }) {
  if (!consentGiven) {
    throw new Error('GDPR consent not given');
  }
  const existing = await db.query('SELECT id FROM customers WHERE phone = $1', [phone]);
  if (existing.rowCount > 0) {
    await db.query('UPDATE customers SET name = $1, consent_given = $2 WHERE id = $3', [name, consentGiven, existing.rows[0].id]);
    return existing.rows[0].id;
  } else {
    const result = await db.query(
      'INSERT INTO customers (name, phone, consent_given) VALUES ($1, $2, $3) RETURNING id',
      [name, phone, consentGiven]
    );
    return result.rows[0].id;
  }
}

// Helper to compute subtotal, restaurant tax percentage, tax amount, and grand total
async function recalculateOrderTotals(orderId, restaurantId) {
  // 1. Fetch restaurant tax percentage and currency
  const restRes = await db.query('SELECT tax_percentage, currency FROM restaurants WHERE id = $1', [restaurantId]);
  const taxPercentage = restRes.rowCount > 0 && restRes.rows[0].tax_percentage != null
    ? parseFloat(restRes.rows[0].tax_percentage)
    : 5.0;
  const currency = restRes.rowCount > 0 && restRes.rows[0].currency ? restRes.rows[0].currency : '₹';

  // 2. Compute subtotal from order_items
  const sumRes = await db.query(
    `SELECT COALESCE(SUM(quantity * price_at_order), 0) AS subtotal 
     FROM order_items WHERE order_id = $1`,
    [orderId]
  );
  const subtotal = parseFloat(sumRes.rows[0].subtotal);
  const taxAmount = Math.round((subtotal * (taxPercentage / 100)) * 100) / 100;
  const grandTotal = Math.round((subtotal + taxAmount) * 100) / 100;

  // 3. Update orders record
  await db.query(
    `UPDATE orders 
     SET subtotal = $1, tax_percentage = $2, tax_amount = $3, total = $4, updated_at = now() 
     WHERE id = $5`,
    [subtotal, taxPercentage, taxAmount, grandTotal, orderId]
  );

  return { subtotal, taxPercentage, taxAmount, grandTotal, currency };
}

// GET /api/order/table/:tableId/session
// Checks if the table currently has an active (unpaid) order session
router.get('/table/:tableId/session', async (req, res) => {
  const { tableId } = req.params;

  try {
    const tableRes = await db.query('SELECT id, number, restaurant_id FROM tables WHERE id = $1', [tableId]);
    if (tableRes.rowCount === 0) {
      return res.status(404).json({ error: 'Table not found' });
    }

    const table = tableRes.rows[0];

    // Find active order for this table that is NOT paid or cancelled
    const activeOrderRes = await db.query(
      `SELECT o.id, o.restaurant_id, o.status, o.subtotal, o.tax_percentage, o.tax_amount, o.total, o.payment_method, o.notes, o.created_at, o.updated_at,
              c.name AS customer_name, c.phone AS customer_phone,
              r.currency
       FROM orders o
       LEFT JOIN customers c ON o.customer_id = c.id
       LEFT JOIN restaurants r ON o.restaurant_id = r.id
       WHERE o.table_id = $1 AND o.status NOT IN ('PAID', 'CANCELLED')
       ORDER BY o.created_at DESC
       LIMIT 1`,
      [tableId]
    );

    if (activeOrderRes.rowCount === 0) {
      return res.json({
        hasActiveSession: false,
        table: { id: table.id, number: table.number }
      });
    }

    const order = activeOrderRes.rows[0];

    // Fetch line items for this active order
    const itemsRes = await db.query(
      `SELECT oi.id, oi.quantity, oi.price_at_order, mi.name AS item_name, mi.category, mi.description
       FROM order_items oi
       JOIN menu_items mi ON oi.menu_item_id = mi.id
       WHERE oi.order_id = $1
       ORDER BY oi.created_at ASC`,
      [order.id]
    );

    return res.json({
      hasActiveSession: true,
      table: { id: table.id, number: table.number },
      orderId: order.id,
      restaurantId: order.restaurant_id,
      status: order.status,
      notes: order.notes,
      currency: order.currency || '₹',
      subtotal: parseFloat(order.subtotal || order.total),
      taxPercentage: parseFloat(order.tax_percentage || 5.0),
      taxAmount: parseFloat(order.tax_amount || 0),
      total: parseFloat(order.total),
      paymentMethod: order.payment_method,
      createdAt: order.created_at,
      customer: {
        name: order.customer_name,
        phone: order.customer_phone
      },
      items: itemsRes.rows.map(it => ({
        ...it,
        price_at_order: parseFloat(it.price_at_order),
        line_total: parseFloat(it.price_at_order) * it.quantity
      }))
    });
  } catch (err) {
    console.error('Check table session error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/order – create a new order (or append to active session if exists)
router.post('/', async (req, res) => {
  const schema = Joi.object({
    restaurantId: Joi.string().uuid().required(),
    tableId: Joi.string().uuid().required(),
    customer: Joi.object({
      name: Joi.string().required(),
      phone: Joi.string().required(),
      consentGiven: Joi.boolean().required(),
    }).optional(),
    notes: Joi.string().allow('', null).optional(),
    items: Joi.array()
      .items(
        Joi.object({
          menuItemId: Joi.string().uuid().required(),
          quantity: Joi.number().integer().min(1).required(),
        })
      )
      .default([]),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const { restaurantId, tableId, customer, items, notes } = value;

  try {
    const [restRes, tableRes] = await Promise.all([
      db.query('SELECT id, tax_percentage FROM restaurants WHERE id = $1', [restaurantId]),
      db.query('SELECT id FROM tables WHERE id = $1', [tableId]),
    ]);
    if (restRes.rowCount === 0) return res.status(404).json({ error: 'Restaurant not found' });
    if (tableRes.rowCount === 0) return res.status(404).json({ error: 'Table not found' });

    const taxPercentage = restRes.rows[0].tax_percentage != null ? parseFloat(restRes.rows[0].tax_percentage) : 5.0;

    // Check if there is already an active session order at this table
    const existingOrderRes = await db.query(
      `SELECT id, status, total FROM orders 
       WHERE table_id = $1 AND status NOT IN ('PAID', 'CANCELLED')
       ORDER BY created_at DESC LIMIT 1`,
      [tableId]
    );

    let orderId;
    let isExistingSession = false;

    if (existingOrderRes.rowCount > 0) {
      orderId = existingOrderRes.rows[0].id;
      isExistingSession = true;
      if (notes) {
        await db.query(`UPDATE orders SET notes = COALESCE(notes || '; ', '') || $1 WHERE id = $2`, [notes, orderId]);
      }
    } else {
      if (!customer) {
        return res.status(400).json({ error: 'Customer details (name, phone, consentGiven) are required for new table order' });
      }
      const customerId = await upsertCustomer(customer);

      const orderRes = await db.query(
        `INSERT INTO orders (restaurant_id, table_id, customer_id, status, notes, subtotal, tax_percentage, tax_amount, total)
         VALUES ($1, $2, $3, 'PENDING', $4, 0, $5, 0, 0) RETURNING id, status, created_at`,
        [restaurantId, tableId, customerId, notes || null, taxPercentage]
      );
      orderId = orderRes.rows[0].id;
    }

    // Insert items
    for (const it of items) {
      const menuRes = await db.query('SELECT price FROM menu_items WHERE id = $1 AND restaurant_id = $2', [it.menuItemId, restaurantId]);
      if (menuRes.rowCount === 0) continue;
      const price = parseFloat(menuRes.rows[0].price);
      await db.query(
        `INSERT INTO order_items (order_id, menu_item_id, quantity, price_at_order)
         VALUES ($1, $2, $3, $4)`,
        [orderId, it.menuItemId, it.quantity, price]
      );
    }

    // Recalculate subtotal, tax, and total
    const totals = await recalculateOrderTotals(orderId, restaurantId);

    // Emit realtime event to kitchen & table rooms
    try {
      const io = getIO();
      const eventName = isExistingSession ? 'order:items_added' : 'order:new';
      io.emit(eventName, {
        orderId,
        tableId,
        status: isExistingSession ? existingOrderRes.rows[0].status : 'PENDING',
        subtotal: totals.subtotal,
        taxPercentage: totals.taxPercentage,
        taxAmount: totals.taxAmount,
        total: totals.grandTotal,
        isExistingSession
      });
      io.to(`table_${tableId}`).emit('order:update', { orderId, total: totals.grandTotal });
    } catch (e) {
      console.warn('Socket.IO emit warning:', e.message);
    }

    res.status(201).json({
      orderId,
      status: isExistingSession ? existingOrderRes.rows[0].status : 'PENDING',
      subtotal: totals.subtotal,
      taxPercentage: totals.taxPercentage,
      taxAmount: totals.taxAmount,
      total: totals.grandTotal,
      currency: totals.currency,
      isExistingSession
    });
  } catch (err) {
    console.error('Create order error:', err);
    if (err.message === 'GDPR consent not given') {
      return res.status(400).json({ error: 'GDPR consent required before storing phone number' });
    }
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/order/:id/items – add more items to an existing order (re-scan flow)
router.post('/:id/items', async (req, res) => {
  const { id: orderId } = req.params;
  const schema = Joi.object({
    items: Joi.array()
      .items(
        Joi.object({
          menuItemId: Joi.string().uuid().required(),
          quantity: Joi.number().integer().min(1).required(),
        })
      )
      .min(1)
      .required(),
  });

  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const orderRes = await db.query('SELECT * FROM orders WHERE id = $1', [orderId]);
    if (orderRes.rowCount === 0) return res.status(404).json({ error: 'Order not found' });

    const order = orderRes.rows[0];
    if (['PAID', 'CANCELLED'].includes(order.status)) {
      return res.status(400).json({ error: `Cannot add items to an order with status: ${order.status}` });
    }

    const { items } = value;
    const addedItems = [];

    for (const it of items) {
      const menuRes = await db.query(
        'SELECT id, name, price FROM menu_items WHERE id = $1 AND restaurant_id = $2',
        [it.menuItemId, order.restaurant_id]
      );
      if (menuRes.rowCount === 0) continue;
      const price = parseFloat(menuRes.rows[0].price);
      await db.query(
        `INSERT INTO order_items (order_id, menu_item_id, quantity, price_at_order)
         VALUES ($1, $2, $3, $4)`,
        [orderId, it.menuItemId, it.quantity, price]
      );
      addedItems.push({
        menuItemId: it.menuItemId,
        name: menuRes.rows[0].name,
        quantity: it.quantity,
        price
      });
    }

    // Recompute subtotal, tax and total
    const totals = await recalculateOrderTotals(orderId, order.restaurant_id);

    // Emit realtime event
    try {
      const io = getIO();
      io.emit('order:items_added', { orderId, tableId: order.table_id, addedItems, total: totals.grandTotal });
      io.to(`table_${order.table_id}`).emit('order:update', { orderId, total: totals.grandTotal });
    } catch (e) {
      console.warn('Socket.IO emit warning:', e.message);
    }

    res.json({
      message: 'Items added successfully',
      orderId,
      tableId: order.table_id,
      subtotal: totals.subtotal,
      taxPercentage: totals.taxPercentage,
      taxAmount: totals.taxAmount,
      total: totals.grandTotal,
      currency: totals.currency,
      addedItems
    });
  } catch (err) {
    console.error('Add items error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// PUT /api/order/:id/dismiss – dismiss/settle order (clears table session)
router.put('/:id/dismiss', async (req, res) => {
  const { id: orderId } = req.params;
  const schema = Joi.object({
    paymentMethod: Joi.string().valid('CASH', 'UPI', 'CARD', 'ONLINE').default('CASH')
  });
  const { value } = schema.validate(req.body || {});
  const paymentMethod = value ? value.paymentMethod || 'CASH' : 'CASH';

  try {
    const result = await db.query(
      `UPDATE orders 
       SET status = 'PAID', payment_method = $1, updated_at = now() 
       WHERE id = $2 
       RETURNING id, table_id, subtotal, tax_percentage, tax_amount, total, payment_method, status`,
      [paymentMethod, orderId]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: 'Order not found' });

    const order = result.rows[0];

    // Emit realtime event to notify table and cashier
    try {
      const io = getIO();
      io.emit('order:dismissed', { orderId, tableId: order.table_id, paymentMethod, status: 'PAID' });
      io.to(`table_${order.table_id}`).emit('session:ended', { orderId, message: 'Table bill settled. Thank you!' });
    } catch (e) {
      console.warn('Socket.IO emit warning:', e.message);
    }

    res.json({
      message: 'Order dismissed and marked as PAID. Table is now free for next customer.',
      order: {
        ...order,
        subtotal: parseFloat(order.subtotal),
        tax_amount: parseFloat(order.tax_amount),
        total: parseFloat(order.total)
      }
    });
  } catch (err) {
    console.error('Dismiss order error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// PUT /api/order/:id/status – update order status (kitchen uses this)
router.put('/:id/status', async (req, res) => {
  const schema = Joi.object({
    status: Joi.string().valid('PENDING', 'PREPARING', 'READY', 'SERVED', 'PAID', 'CANCELLED').required(),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });
  const { status } = value;
  const { id } = req.params;

  try {
    const result = await db.query('UPDATE orders SET status = $1, updated_at = now() WHERE id = $2 RETURNING table_id, total', [status, id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Order not found' });
    const { table_id: tableId, total } = result.rows[0];
    try {
      const io = getIO();
      io.emit('order:status', { orderId: id, status, total });
      io.to(`table_${tableId}`).emit('order:update', { orderId: id, status, total });
    } catch (e) {
      console.warn('Socket.IO emit warning:', e.message);
    }
    res.json({ orderId: id, status, total: parseFloat(total) });
  } catch (err) {
    console.error('Update status error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/order/:id – fetch order details (including items)
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const orderRes = await db.query('SELECT * FROM orders WHERE id = $1', [id]);
    if (orderRes.rowCount === 0) return res.status(404).json({ error: 'Order not found' });
    const order = orderRes.rows[0];
    const itemsRes = await db.query(
      `SELECT oi.id, oi.quantity, oi.price_at_order, mi.name, mi.category, mi.description
       FROM order_items oi
       JOIN menu_items mi ON oi.menu_item_id = mi.id
       WHERE oi.order_id = $1`,
      [id]
    );
    order.items = itemsRes.rows.map(it => ({
      ...it,
      price_at_order: parseFloat(it.price_at_order),
      line_total: parseFloat(it.price_at_order) * it.quantity
    }));
    order.subtotal = parseFloat(order.subtotal || order.total);
    order.tax_amount = parseFloat(order.tax_amount || 0);
    order.total = parseFloat(order.total);
    res.json(order);
  } catch (err) {
    console.error('Get order error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/order/:id/feedback – customer submits 1-5 star review after meal
router.post('/:id/feedback', async (req, res) => {
  const { id: orderId } = req.params;
  const schema = Joi.object({
    rating: Joi.number().integer().min(1).max(5).required(),
    comments: Joi.string().allow('', null).optional(),
  });

  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const { rating, comments } = value;

  try {
    const orderRes = await db.query('SELECT id, restaurant_id, table_id, customer_id, total FROM orders WHERE id = $1', [orderId]);
    if (orderRes.rowCount === 0) return res.status(404).json({ error: 'Order not found' });

    const order = orderRes.rows[0];

    // Insert feedback
    const feedbackRes = await db.query(
      `INSERT INTO order_feedback (order_id, restaurant_id, rating, comments)
       VALUES ($1, $2, $3, $4)
       RETURNING id, rating, comments, created_at`,
      [orderId, order.restaurant_id, rating, comments || null]
    );

    const feedback = feedbackRes.rows[0];

    // Emit real-time feedback alert to admin dashboard
    try {
      const io = getIO();
      io.emit('feedback:new', {
        orderId,
        tableId: order.table_id,
        rating,
        comments,
        isCritical: rating <= 2
      });
    } catch (e) {
      console.warn('Socket emit warning:', e.message);
    }

    res.status(201).json({
      message: 'Thank you for your valuable feedback!',
      feedback
    });
  } catch (err) {
    console.error('Submit feedback error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
