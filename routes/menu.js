// routes/menu.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const Joi = require('joi');

// GET /api/menu/:restaurantId
router.get('/:restaurantId', async (req, res) => {
  const { restaurantId } = req.params;
  // Simple validation – UUID format (Postgres uses uuid)
  const schema = Joi.string().uuid().required();
  const { error } = schema.validate(restaurantId);
  if (error) return res.status(400).json({ error: 'Invalid restaurantId' });

  try {
    const result = await db.query(
      `SELECT id, name, description, price, photo_url, available FROM menu_items WHERE restaurant_id = $1 ORDER BY name`,
      [restaurantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Menu fetch error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;

