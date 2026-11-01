// routes/admin.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const Joi = require('joi');
const { verifyToken } = require('../middleware/auth');

// Simple static admin login – you can replace with Supabase Auth later
router.post('/login', async (req, res) => {
  const schema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const { email, password } = value;
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPass = process.env.ADMIN_PASS;
  if (email !== adminEmail || password !== adminPass) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const { issueToken } = require('../middleware/auth');
  const token = issueToken({ email });
  res.json({ token });
});

// Protect all following routes
router.use(verifyToken);

// ----- Restaurant CRUD (only one for now) -----
router.get('/restaurant/:id', async (req, res) => {
  const { id } = req.params;
  const result = await db.query('SELECT * FROM restaurants WHERE id = $1', [id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Restaurant not found' });
  res.json(result.rows[0]);
});

router.post('/restaurant', async (req, res) => {
  const schema = Joi.object({
    name: Joi.string().required(),
    owner_name: Joi.string().optional(),
    address: Joi.string().optional(),
    phone: Joi.string().optional(),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });
  const { name, owner_name, address, phone } = value;
  const result = await db.query(
    'INSERT INTO restaurants (name, owner_name, address, phone) VALUES ($1, $2, $3, $4) RETURNING *',
    [name, owner_name, address, phone]
  );
  res.status(201).json(result.rows[0]);
});

router.put('/restaurant/:id', async (req, res) => {
  const { id } = req.params;
  const schema = Joi.object({
    name: Joi.string().optional(),
    owner_name: Joi.string().optional(),
    address: Joi.string().optional(),
    phone: Joi.string().optional(),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });
  const fields = [];
  const values = [];
  let idx = 1;
  for (const [key, val] of Object.entries(value)) {
    fields.push(`${key} = $${idx}`);
    values.push(val);
    idx++;
  }
  if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
  values.push(id);
  const query = `UPDATE restaurants SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`;
  const result = await db.query(query, values);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Restaurant not found' });
  res.json(result.rows[0]);
});

// ----- Table CRUD -----
router.get('/tables/:restaurantId', async (req, res) => {
  const { restaurantId } = req.params;
  const result = await db.query('SELECT * FROM tables WHERE restaurant_id = $1 ORDER BY number', [restaurantId]);
  res.json(result.rows);
});

router.post('/tables', async (req, res) => {
  const schema = Joi.object({
    number: Joi.number().integer().min(1).required(),
    restaurantId: Joi.string().uuid().required(),
    qrCodeUrl: Joi.string().uri().optional(),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });
  const { number, restaurantId, qrCodeUrl } = value;
  const result = await db.query(
    'INSERT INTO tables (number, restaurant_id, qr_code_url) VALUES ($1, $2, $3) RETURNING *',
    [number, restaurantId, qrCodeUrl]
  );
  res.status(201).json(result.rows[0]);
});

router.put('/tables/:id', async (req, res) => {
  const { id } = req.params;
  const schema = Joi.object({
    number: Joi.number().integer().min(1).optional(),
    qrCodeUrl: Joi.string().uri().optional(),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });
  const fields = [];
  const values = [];
  let idx = 1;
  for (const [key, val] of Object.entries(value)) {
    fields.push(`${key} = $${idx}`);
    values.push(val);
    idx++;
  }
  if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
  values.push(id);
  const query = `UPDATE tables SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`;
  const result = await db.query(query, values);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Table not found' });
  res.json(result.rows[0]);
});

// ----- MenuItem CRUD -----
router.get('/menu/:restaurantId', async (req, res) => {
  const { restaurantId } = req.params;
  const result = await db.query('SELECT * FROM menu_items WHERE restaurant_id = $1 ORDER BY name', [restaurantId]);
  res.json(result.rows);
});

router.post('/menu', async (req, res) => {
  const schema = Joi.object({
    restaurantId: Joi.string().uuid().required(),
    name: Joi.string().required(),
    description: Joi.string().optional(),
    price: Joi.number().precision(2).required(),
    photoUrl: Joi.string().uri().optional(),
    available: Joi.boolean().optional(),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });
  const { restaurantId, name, description, price, photoUrl, available } = value;
  const result = await db.query(
    `INSERT INTO menu_items (restaurant_id, name, description, price, photo_url, available)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [restaurantId, name, description, price, photoUrl, available]
  );
  res.status(201).json(result.rows[0]);
});

router.put('/menu/:id', async (req, res) => {
  const { id } = req.params;
  const schema = Joi.object({
    name: Joi.string().optional(),
    description: Joi.string().optional(),
    price: Joi.number().precision(2).optional(),
    photoUrl: Joi.string().uri().optional(),
    available: Joi.boolean().optional(),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });
  const fields = [];
  const values = [];
  let idx = 1;
  for (const [key, val] of Object.entries(value)) {
    const column = key === 'photoUrl' ? 'photo_url' : key;
    fields.push(`${column} = $${idx}`);
    values.push(val);
    idx++;
  }
  if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
  values.push(id);
  const query = `UPDATE menu_items SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`;
  const result = await db.query(query, values);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Menu item not found' });
  res.json(result.rows[0]);
});

router.delete('/menu/:id', async (req, res) => {
  const { id } = req.params;
  const result = await db.query('DELETE FROM menu_items WHERE id = $1 RETURNING *', [id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Menu item not found' });
  res.json({ message: 'Deleted', item: result.rows[0] });
});

// ----- Orders Management (Admin / Kitchen) -----
router.get('/orders', async (req, res) => {
  const { status, restaurantId } = req.query;
  try {
    let query = `
      SELECT o.id, o.restaurant_id, o.status, o.total, o.created_at, o.updated_at,
             t.number AS table_number, t.id AS table_id,
             c.name AS customer_name, c.phone AS customer_phone,
             COALESCE(
               json_agg(
                 json_build_object(
                   'id', oi.id,
                   'quantity', oi.quantity,
                   'price', oi.price_at_order,
                   'item_name', mi.name
                 )
               ) FILTER (WHERE oi.id IS NOT NULL), '[]'
             ) AS items
      FROM orders o
      LEFT JOIN tables t ON o.table_id = t.id
      LEFT JOIN customers c ON o.customer_id = c.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
      WHERE 1=1
    `;
    const params = [];
    if (restaurantId) {
      params.push(restaurantId);
      query += ` AND o.restaurant_id = $${params.length}`;
    }
    if (status) {
      params.push(status);
      query += ` AND o.status = $${params.length}`;
    }
    query += ` GROUP BY o.id, t.number, t.id, c.name, c.phone ORDER BY o.created_at DESC`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Fetch admin orders error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ----- Analytics Dashboard -----
router.get('/analytics/summary', async (req, res) => {
  const { restaurantId } = req.query;
  try {
    const params = restaurantId ? [restaurantId] : [];
    const restFilter = restaurantId ? `WHERE restaurant_id = $1` : '';

    // 1. Today's sales and order count
    const todaySalesQuery = `
      SELECT 
        COUNT(id) AS total_orders,
        COALESCE(SUM(total), 0) AS total_revenue
      FROM orders
      ${restFilter ? restFilter + ' AND' : 'WHERE'} created_at >= CURRENT_DATE
    `;
    const todaySales = await db.query(todaySalesQuery, params);

    // 2. Sales per table
    const tableSalesQuery = `
      SELECT t.number AS table_number, COUNT(o.id) as orders_count, COALESCE(SUM(o.total), 0) as revenue
      FROM orders o
      JOIN tables t ON o.table_id = t.id
      ${restaurantId ? 'WHERE o.restaurant_id = $1' : ''}
      GROUP BY t.number
      ORDER BY revenue DESC
    `;
    const tableSales = await db.query(tableSalesQuery, params);

    // 3. Top-selling dishes
    const topDishesQuery = `
      SELECT mi.name, SUM(oi.quantity) as quantity_sold, SUM(oi.quantity * oi.price_at_order) as revenue
      FROM order_items oi
      JOIN menu_items mi ON oi.menu_item_id = mi.id
      JOIN orders o ON oi.order_id = o.id
      ${restaurantId ? 'WHERE o.restaurant_id = $1' : ''}
      GROUP BY mi.name
      ORDER BY quantity_sold DESC
      LIMIT 5
    `;
    const topDishes = await db.query(topDishesQuery, params);

    res.json({
      today: todaySales.rows[0],
      salesByTable: tableSales.rows,
      topSellingDishes: topDishes.rows
    });
  } catch (err) {
    console.error('Analytics error:', err);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

module.exports = router;

