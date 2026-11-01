// routes/menu.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const Joi = require('joi');

// GET /api/menu/:restaurantId/categories
// Returns list of unique categories available in the restaurant
router.get('/:restaurantId/categories', async (req, res) => {
  const { restaurantId } = req.params;
  const schema = Joi.string().uuid().required();
  const { error } = schema.validate(restaurantId);
  if (error) return res.status(400).json({ error: 'Invalid restaurantId' });

  try {
    const result = await db.query(
      `SELECT DISTINCT COALESCE(category, 'General') AS category 
       FROM menu_items 
       WHERE restaurant_id = $1 
       ORDER BY category ASC`,
      [restaurantId]
    );
    res.json(result.rows.map(r => r.category));
  } catch (err) {
    console.error('Fetch categories error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/menu/:restaurantId
// Supports query params: ?category=xxx & ?availableOnly=true & ?groupByCategory=true
router.get('/:restaurantId', async (req, res) => {
  const { restaurantId } = req.params;
  const { category, availableOnly, groupByCategory } = req.query;

  const schema = Joi.string().uuid().required();
  const { error } = schema.validate(restaurantId);
  if (error) return res.status(400).json({ error: 'Invalid restaurantId' });

  try {
    let query = `
      SELECT id, name, description, price, photo_url, COALESCE(category, 'General') AS category, available, created_at 
      FROM menu_items 
      WHERE restaurant_id = $1
    `;
    const params = [restaurantId];

    if (category) {
      params.push(category);
      query += ` AND category = $${params.length}`;
    }

    if (availableOnly === 'true') {
      query += ` AND available = true`;
    }

    query += ` ORDER BY category ASC, name ASC`;

    const result = await db.query(query, params);
    const items = result.rows.map(item => ({
      ...item,
      price: parseFloat(item.price)
    }));

    if (groupByCategory === 'true') {
      const grouped = {};
      const categories = [];

      items.forEach(item => {
        const cat = item.category || 'General';
        if (!grouped[cat]) {
          grouped[cat] = [];
          categories.push(cat);
        }
        grouped[cat].push(item);
      });

      return res.json({
        categories,
        itemsByCategory: grouped,
        totalItems: items.length
      });
    }

    res.json(items);
  } catch (err) {
    console.error('Menu fetch error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
