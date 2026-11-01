// routes/order.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const Joi = require('joi');
const { getIO } = require('../socket'); // emit realtime events

// Helper to upsert a customer (by phone) and optionally enforce consent
async function upsertCustomer({ name, phone, consentGiven }) {
  // If consentGiven is false, we refuse to store the phone number
  if (!consentGiven) {
    throw new Error('GDPR consent not given');
  }
  const existing = await db.query('SELECT id FROM customers WHERE phone = $1', [phone]);
  if (existing.rowCount > 0) {
    // update name/consent if changed
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

// POST /api/order – create a new order (with optional items)
router.post('/', async (req, res) => {
  const schema = Joi.object({
    restaurantId: Joi.string().uuid().required(),
    tableId: Joi.string().uuid().required(),
    customer: Joi.object({
      name: Joi.string().required(),
      phone: Joi.string().required(),
      consentGiven: Joi.boolean().required(),
    }).required(),
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
    // Ensure restaurant, table exist (light check)
    const [restRes, tableRes] = await Promise.all([
      db.query('SELECT id FROM restaurants WHERE id = $1', [restaurantId]),
      db.query('SELECT id FROM tables WHERE id = $1', [tableId]),
    ]);
    if (restRes.rowCount === 0) return res.status(404).json({ error: 'Restaurant not found' });
    if (tableRes.rowCount === 0) return res.status(404).json({ error: 'Table not found' });

    const customerId = await upsertCustomer(customer);

    // Insert order skeleton
    const orderRes = await db.query(
      `INSERT INTO orders (restaurant_id, table_id, customer_id, status, total)
       VALUES ($1, $2, $3, 'PENDING', 0) RETURNING id, status, total, created_at`,
      [restaurantId, tableId, customerId]
    );
    const orderId = orderRes.rows[0].id;

    // Insert items, compute total
    let total = 0;
    for (const it of items) {
      const menuRes = await db.query('SELECT price FROM menu_items WHERE id = $1 AND restaurant_id = $2', [it.menuItemId, restaurantId]);
      if (menuRes.rowCount === 0) continue; // skip missing items
      const price = parseFloat(menuRes.rows[0].price);
      const lineTotal = price * it.quantity;
      total += lineTotal;
      await db.query(
        `INSERT INTO order_items (order_id, menu_item_id, quantity, price_at_order)
         VALUES ($1, $2, $3, $4)`,
        [orderId, it.menuItemId, it.quantity, price]
      );
    }
    // Update total on order record
    await db.query('UPDATE orders SET total = $1 WHERE id = $2', [total, orderId]);

    // Emit realtime event to kitchen & table rooms
    try {
      const io = getIO();
      io.emit('order:new', { orderId, tableId, status: 'PENDING', total });
      io.to(`table_${tableId}`).emit('order:update', { orderId, status: 'PENDING', total });
    } catch (e) {
      console.warn('Socket.IO emit warning:', e.message);
    }

    res.status(201).json({ orderId, status: 'PENDING', total });
  } catch (err) {
    console.error('Create order error:', err);
    if (err.message === 'GDPR consent not given') {
      return res.status(400).json({ error: 'GDPR consent required before storing phone number' });
    }
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
    // Emit updates
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

