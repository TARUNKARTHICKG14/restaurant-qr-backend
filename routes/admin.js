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
  const result = await db.query('SELECT * FROM menu_items WHERE restaurant_id = $1 ORDER BY category ASC, name ASC', [restaurantId]);
  res.json(result.rows);
});

router.post('/menu', async (req, res) => {
  const schema = Joi.object({
    restaurantId: Joi.string().uuid().required(),
    name: Joi.string().required(),
    description: Joi.string().optional(),
    category: Joi.string().default('Main Course'),
    price: Joi.number().precision(2).required(),
    photoUrl: Joi.string().uri().optional(),
    available: Joi.boolean().default(true),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });
  const { restaurantId, name, description, category, price, photoUrl, available } = value;
  const result = await db.query(
    `INSERT INTO menu_items (restaurant_id, name, description, category, price, photo_url, available)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [restaurantId, name, description, category, price, photoUrl, available]
  );
  res.status(201).json(result.rows[0]);
});

router.put('/menu/:id', async (req, res) => {
  const { id } = req.params;
  const schema = Joi.object({
    name: Joi.string().optional(),
    description: Joi.string().optional(),
    category: Joi.string().optional(),
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

// Fast one-click availability toggle with real-time broadcast to all table clients
router.put('/menu/:id/toggle-availability', async (req, res) => {
  const { id } = req.params;
  const result = await db.query(
    `UPDATE menu_items 
     SET available = NOT available 
     WHERE id = $1 
     RETURNING id, restaurant_id, name, available`,
    [id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Menu item not found' });
  
  const updatedItem = result.rows[0];

  // Broadcast out-of-stock / restocked update to all table apps
  try {
    const { getIO } = require('../socket');
    getIO().emit('menu:availability_changed', updatedItem);
  } catch (e) {
    console.warn('Socket broadcast warning:', e.message);
  }

  res.json({
    message: `Menu item '${updatedItem.name}' is now ${updatedItem.available ? 'AVAILABLE' : 'UNAVAILABLE'}`,
    item: updatedItem
  });
});

router.delete('/menu/:id', async (req, res) => {
  const { id } = req.params;
  const result = await db.query('DELETE FROM menu_items WHERE id = $1 RETURNING *', [id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Menu item not found' });
  res.json({ message: 'Deleted', item: result.rows[0] });
});

// PUT /api/admin/restaurant/:id/tax – configure restaurant tax percentage & currency
router.put('/restaurant/:id/tax', async (req, res) => {
  const { id } = req.params;
  const schema = Joi.object({
    taxPercentage: Joi.number().precision(2).min(0).max(100).required(),
    currency: Joi.string().default('₹')
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const result = await db.query(
      `UPDATE restaurants 
       SET tax_percentage = $1, currency = $2 
       WHERE id = $3 
       RETURNING id, name, tax_percentage, currency`,
      [value.taxPercentage, value.currency, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Restaurant not found' });
    res.json({
      message: 'Restaurant tax settings updated successfully',
      restaurant: result.rows[0]
    });
  } catch (err) {
    console.error('Update tax settings error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ----- Orders Management (Admin / Kitchen) -----
router.get('/orders', async (req, res) => {
  const { status, restaurantId } = req.query;
  try {
    let query = `
      SELECT o.id, o.restaurant_id, o.status, o.subtotal, o.tax_percentage, o.tax_amount, o.total, o.payment_method, o.notes, o.created_at, o.updated_at,
             t.number AS table_number, t.id AS table_id,
             c.name AS customer_name, c.phone AS customer_phone,
             COALESCE(
               json_agg(
                 json_build_object(
                   'id', oi.id,
                   'quantity', oi.quantity,
                   'price', oi.price_at_order,
                   'item_name', mi.name,
                   'category', mi.category
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

// ----- Customer Directory & Order History -----
// GET /api/admin/customers – list all customers with visit count & lifetime spending
router.get('/customers', async (req, res) => {
  const { restaurantId } = req.query;
  try {
    const params = restaurantId ? [restaurantId] : [];
    const query = `
      SELECT c.id, c.name, c.phone, c.consent_given, c.created_at AS first_seen,
             COUNT(DISTINCT o.id) AS total_orders,
             COALESCE(SUM(o.total), 0) AS lifetime_spend,
             MAX(o.created_at) AS last_visit
      FROM customers c
      JOIN orders o ON c.id = o.customer_id
      ${restaurantId ? 'WHERE o.restaurant_id = $1' : ''}
      GROUP BY c.id
      ORDER BY lifetime_spend DESC
    `;
    const result = await db.query(query, params);
    res.json(result.rows.map(r => ({
      ...r,
      total_orders: parseInt(r.total_orders, 10),
      lifetime_spend: parseFloat(r.lifetime_spend)
    })));
  } catch (err) {
    console.error('Customer list error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/admin/customers/:id/history – full order history for a single customer
router.get('/customers/:id/history', async (req, res) => {
  const { id: customerId } = req.params;
  try {
    const custRes = await db.query('SELECT * FROM customers WHERE id = $1', [customerId]);
    if (custRes.rowCount === 0) return res.status(404).json({ error: 'Customer not found' });

    const ordersRes = await db.query(
      `SELECT o.id, o.restaurant_id, o.status, o.subtotal, o.tax_percentage, o.tax_amount, o.total, o.payment_method, o.created_at,
              t.number AS table_number,
              COALESCE(
                json_agg(
                  json_build_object(
                    'quantity', oi.quantity,
                    'price', oi.price_at_order,
                    'item_name', mi.name
                  )
                ) FILTER (WHERE oi.id IS NOT NULL), '[]'
              ) AS items
       FROM orders o
       LEFT JOIN tables t ON o.table_id = t.id
       LEFT JOIN order_items oi ON o.id = oi.order_id
       LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
       WHERE o.customer_id = $1
       GROUP BY o.id, t.number
       ORDER BY o.created_at DESC`,
      [customerId]
    );

    res.json({
      customer: custRes.rows[0],
      orders: ordersRes.rows.map(o => ({
        ...o,
        subtotal: parseFloat(o.subtotal || o.total),
        tax_amount: parseFloat(o.tax_amount || 0),
        total: parseFloat(o.total)
      }))
    });
  } catch (err) {
    console.error('Customer history error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ----- Comprehensive Analytics Dashboard -----
router.get('/analytics/overview', async (req, res) => {
  const { restaurantId } = req.query;
  try {
    const params = restaurantId ? [restaurantId] : [];
    const restFilter = restaurantId ? `WHERE restaurant_id = $1` : '';
    const orderRestFilter = restaurantId ? `AND o.restaurant_id = $1` : '';

    // 1. Today's performance (revenue, customer count, taxes, AOV)
    const todayQuery = `
      SELECT 
        COUNT(DISTINCT id) AS total_orders,
        COUNT(DISTINCT customer_id) AS unique_customers,
        COALESCE(SUM(subtotal), 0) AS total_subtotal,
        COALESCE(SUM(tax_amount), 0) AS total_tax_collected,
        COALESCE(SUM(total), 0) AS total_revenue,
        COALESCE(ROUND(AVG(total), 2), 0) AS average_order_value
      FROM orders
      ${restFilter ? restFilter + ' AND' : 'WHERE'} created_at >= CURRENT_DATE
    `;
    const todayRes = await db.query(todayQuery, params);

    // 2. Sales per table ranking (which table sales more)
    const tableSalesQuery = `
      SELECT t.number AS table_number, 
             t.id AS table_id,
             COUNT(o.id) AS orders_count, 
             COALESCE(SUM(o.total), 0) AS revenue,
             ROUND(COALESCE(AVG(o.total), 0), 2) AS avg_spend_per_table
      FROM orders o
      JOIN tables t ON o.table_id = t.id
      WHERE 1=1 ${orderRestFilter}
      GROUP BY t.number, t.id
      ORDER BY revenue DESC
    `;
    const tableSales = await db.query(tableSalesQuery, params);

    // 3. Hourly order rush breakdown for today
    const hourlyQuery = `
      SELECT 
        TO_CHAR(created_at, 'HH24:00') AS hour_slot,
        COUNT(id) AS order_count,
        COALESCE(SUM(total), 0) AS revenue
      FROM orders
      ${restFilter ? restFilter + ' AND' : 'WHERE'} created_at >= CURRENT_DATE
      GROUP BY hour_slot
      ORDER BY hour_slot ASC
    `;
    const hourlyRes = await db.query(hourlyQuery, params);

    // 4. Sales by payment method (CASH, UPI, CARD)
    const paymentMethodQuery = `
      SELECT COALESCE(o.payment_method, 'CASH') AS method,
             COUNT(o.id) AS count,
             COALESCE(SUM(o.total), 0) AS total_amount
      FROM orders o
      WHERE o.status = 'PAID' ${orderRestFilter}
      GROUP BY o.payment_method
      ORDER BY total_amount DESC
    `;
    const paymentRes = await db.query(paymentMethodQuery, params);

    // 5. Top 5 selling dishes
    const topDishesQuery = `
      SELECT mi.name, mi.category,
             SUM(oi.quantity) AS quantity_sold, 
             SUM(oi.quantity * oi.price_at_order) AS revenue
      FROM order_items oi
      JOIN menu_items mi ON oi.menu_item_id = mi.id
      JOIN orders o ON oi.order_id = o.id
      WHERE 1=1 ${orderRestFilter}
      GROUP BY mi.name, mi.category
      ORDER BY quantity_sold DESC
      LIMIT 5
    `;
    const topDishes = await db.query(topDishesQuery, params);

    res.json({
      today: {
        totalOrders: parseInt(todayRes.rows[0].total_orders, 10),
        uniqueCustomers: parseInt(todayRes.rows[0].unique_customers, 10),
        totalSubtotal: parseFloat(todayRes.rows[0].total_subtotal),
        totalTaxCollected: parseFloat(todayRes.rows[0].total_tax_collected),
        totalRevenue: parseFloat(todayRes.rows[0].total_revenue),
        averageOrderValue: parseFloat(todayRes.rows[0].average_order_value)
      },
      salesByTable: tableSales.rows.map(r => ({
        tableNumber: r.table_number,
        ordersCount: parseInt(r.orders_count, 10),
        revenue: parseFloat(r.revenue),
        avgSpend: parseFloat(r.avg_spend_per_table)
      })),
      hourlySales: hourlyRes.rows.map(r => ({
        hour: r.hour_slot,
        orderCount: parseInt(r.order_count, 10),
        revenue: parseFloat(r.revenue)
      })),
      paymentBreakdown: paymentRes.rows.map(r => ({
        method: r.method,
        count: parseInt(r.count, 10),
        amount: parseFloat(r.total_amount)
      })),
      topSellingDishes: topDishes.rows.map(r => ({
        name: r.name,
        category: r.category,
        quantitySold: parseInt(r.quantity_sold, 10),
        revenue: parseFloat(r.revenue)
      }))
    });
  } catch (err) {
    console.error('Analytics overview error:', err);
    res.status(500).json({ error: 'Failed to fetch analytics overview' });
  }
});

// GET /api/admin/feedback – customer ratings and reviews feed
router.get('/feedback', async (req, res) => {
  const { restaurantId } = req.query;
  try {
    const params = restaurantId ? [restaurantId] : [];
    const query = `
      SELECT f.id, f.rating, f.comments, f.created_at,
             o.id AS order_id, o.total AS order_total,
             t.number AS table_number,
             c.name AS customer_name, c.phone AS customer_phone
      FROM order_feedback f
      JOIN orders o ON f.order_id = o.id
      LEFT JOIN tables t ON o.table_id = t.id
      LEFT JOIN customers c ON o.customer_id = c.id
      ${restaurantId ? 'WHERE f.restaurant_id = $1' : ''}
      ORDER BY f.created_at DESC
    `;
    const result = await db.query(query, params);

    // Summary calculation
    const avgQuery = `
      SELECT 
        COUNT(id) AS total_reviews,
        COALESCE(ROUND(AVG(rating), 2), 0) AS average_rating
      FROM order_feedback
      ${restaurantId ? 'WHERE restaurant_id = $1' : ''}
    `;
    const avgRes = await db.query(avgQuery, params);

    res.json({
      summary: {
        totalReviews: parseInt(avgRes.rows[0].total_reviews, 10),
        averageRating: parseFloat(avgRes.rows[0].average_rating)
      },
      reviews: result.rows.map(r => ({
        ...r,
        order_total: parseFloat(r.order_total)
      }))
    });
  } catch (err) {
    console.error('Fetch feedback error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Legacy backward compatibility alias for summary
router.get('/analytics/summary', async (req, res) => {
  req.url = '/analytics/overview';
  router.handle(req, res);
});

module.exports = router;

