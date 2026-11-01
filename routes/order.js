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

// GET /api/order/table/:tableId/session
// Checks if the table currently has an active (unpaid) order session
router.get('/table/:tableId/session', async (req, res) => {
  const { tableId } = req.params;

  try {
    const tableRes = await db.query('SELECT id, number FROM tables WHERE id = $1', [tableId]);
    if (tableRes.rowCount === 0) {
      return res.status(404).json({ error: 'Table not found' });
    }

    // Find active order for this table that is NOT paid or cancelled
    const activeOrderRes = await db.query(
      `SELECT o.id, o.restaurant_id, o.status, o.total, o.created_at, o.updated_at,
              c.name AS customer_name, c.phone AS customer_phone
       FROM orders o
       LEFT JOIN customers c ON o.customer_id = c.id
       WHERE o.table_id = $1 AND o.status NOT IN ('PAID', 'CANCELLED')
       ORDER BY o.created_at DESC
       LIMIT 1`,
      [tableId]
    );

    if (activeOrderRes.rowCount === 0) {
      return res.json({
        hasActiveSession: false,
        table: tableRes.rows[0]
      });
    }

    const order = activeOrderRes.rows[0];

    // Fetch line items for this active order
    const itemsRes = await db.query(
      `SELECT oi.id, oi.quantity, oi.price_at_order, mi.name AS item_name, mi.description
       FROM order_items oi
       JOIN menu_items mi ON oi.menu_item_id = mi.id
       WHERE oi.order_id = $1
       ORDER BY oi.created_at ASC`,
      [order.id]
    );

    return res.json({
      hasActiveSession: true,
      table: tableRes.rows[0],
      orderId: order.id,
      restaurantId: order.restaurant_id,
      status: order.status,
      total: parseFloat(order.total),
      createdAt: order.created_at,
      customer: {
        name: order.customer_name,
        phone: order.customer_phone
      },
      items: itemsRes.rows
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

  const { restaurantId, tableId, customer, items } = value;

  try {
    const [restRes, tableRes] = await Promise.all([
      db.query('SELECT id FROM restaurants WHERE id = $1', [restaurantId]),
      db.query('SELECT id FROM tables WHERE id = $1', [tableId]),
    ]);
    if (restRes.rowCount === 0) return res.status(404).json({ error: 'Restaurant not found' });
    if (tableRes.rowCount === 0) return res.status(404).json({ error: 'Table not found' });

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
      // Append to the existing active order
      orderId = existingOrderRes.rows[0].id;
      isExistingSession = true;
    } else {
      // Require customer details for a brand new session
      if (!customer) {
        return res.status(400).json({ error: 'Customer details (name, phone, consentGiven) are required for new table order' });
      }
      const customerId = await upsertCustomer(customer);

      const orderRes = await db.query(
        `INSERT INTO orders (restaurant_id, table_id, customer_id, status, total)
         VALUES ($1, $2, $3, 'PENDING', 0) RETURNING id, status, total, created_at`,
        [restaurantId, tableId, customerId]
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

    // Recalculate full total from all order_items
    const totalRes = await db.query(
      `SELECT COALESCE(SUM(quantity * price_at_order), 0) AS new_total 
       FROM order_items WHERE order_id = $1`,
      [orderId]
    );
    const total = parseFloat(totalRes.rows[0].new_total);
    await db.query('UPDATE orders SET total = $1, updated_at = now() WHERE id = $2', [total, orderId]);

    // Emit realtime event to kitchen & table rooms
    try {
      const io = getIO();
      const eventName = isExistingSession ? 'order:items_added' : 'order:new';
      io.emit(eventName, { orderId, tableId, status: isExistingSession ? existingOrderRes.rows[0].status : 'PENDING', total, isExistingSession });
      io.to(`table_${tableId}`).emit('order:update', { orderId, total });
    } catch (e) {
      console.warn('Socket.IO emit warning:', e.message);
    }

    res.status(201).json({
      orderId,
      status: isExistingSession ? existingOrderRes.rows[0].status : 'PENDING',
      total,
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

    // Recompute total
    const totalRes = await db.query(
      `SELECT COALESCE(SUM(quantity * price_at_order), 0) AS new_total 
       FROM order_items WHERE order_id = $1`,
      [orderId]
    );
    const total = parseFloat(totalRes.rows[0].new_total);
    await db.query('UPDATE orders SET total = $1, updated_at = now() WHERE id = $2', [total, orderId]);

    // Emit realtime event
    try {
      const io = getIO();
      io.emit('order:items_added', { orderId, tableId: order.table_id, addedItems, total });
      io.to(`table_${order.table_id}`).emit('order:update', { orderId, total });
    } catch (e) {
      console.warn('Socket.IO emit warning:', e.message);
    }

    res.json({
      message: 'Items added successfully',
      orderId,
      tableId: order.table_id,
      total,
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

  try {
    const result = await db.query(
      `UPDATE orders 
       SET status = 'PAID', updated_at = now() 
       WHERE id = $1 
       RETURNING id, table_id, total, status`,
      [orderId]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: 'Order not found' });

    const order = result.rows[0];

    // Emit realtime event to notify table and cashier
    try {
      const io = getIO();
      io.emit('order:dismissed', { orderId, tableId: order.table_id, status: 'PAID' });
      io.to(`table_${order.table_id}`).emit('session:ended', { orderId, message: 'Table bill settled. Thank you!' });
    } catch (e) {
      console.warn('Socket.IO emit warning:', e.message);
    }

    res.json({
      message: 'Order dismissed and marked as PAID. Table is now free for next customer.',
      order
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
    res.json({ orderId: id, status, total });
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
      `SELECT oi.id, oi.quantity, oi.price_at_order, mi.name, mi.description
       FROM order_items oi
       JOIN menu_items mi ON oi.menu_item_id = mi.id
       WHERE oi.order_id = $1`,
      [id]
    );
    order.items = itemsRes.rows;
    res.json(order);
  } catch (err) {
    console.error('Get order error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
