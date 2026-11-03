// routes/kitchen.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const Joi = require('joi');
const { getIO } = require('../socket');

// GET /api/kitchen/tickets
// Returns active orders for the Kitchen Display System (KDS), grouped by status with elapsed wait times
router.get('/tickets', async (req, res) => {
  const { restaurantId } = req.query;

  try {
    let query = `
      SELECT o.id AS id, o.id AS order_id, o.restaurant_id, o.status, o.notes, o.created_at, o.updated_at,
             ROUND(EXTRACT(EPOCH FROM (now() - o.created_at)) / 60) AS elapsed_minutes,
             t.number AS table_number, t.id AS table_id,
             c.name AS customer_name,
             COALESCE(
               json_agg(
                 json_build_object(
                   'id', oi.id,
                   'quantity', oi.quantity,
                   'item_name', mi.name,
                   'name', mi.name,
                   'category', mi.category
                 )
               ) FILTER (WHERE oi.id IS NOT NULL), '[]'
             ) AS items
      FROM orders o
      JOIN tables t ON o.table_id = t.id
      LEFT JOIN customers c ON o.customer_id = c.id
      JOIN order_items oi ON o.id = oi.order_id
      JOIN menu_items mi ON oi.menu_item_id = mi.id
      WHERE o.status IN ('PENDING', 'PREPARING', 'READY')
    `;
    const params = [];

    if (restaurantId) {
      params.push(restaurantId);
      query += ` AND o.restaurant_id = $${params.length}`;
    }

    query += ` GROUP BY o.id, t.number, t.id, c.name ORDER BY o.created_at ASC`;

    const result = await db.query(query, params);
    const tickets = result.rows.map(ticket => ({
      ...ticket,
      id: ticket.id || ticket.order_id,
      order_id: ticket.order_id || ticket.id,
      elapsed_minutes: parseInt(ticket.elapsed_minutes, 10) || 0
    }));

    // Group by status for easy column display in KDS UI
    const grouped = {
      pending: tickets.filter(t => t.status === 'PENDING'),
      preparing: tickets.filter(t => t.status === 'PREPARING'),
      ready: tickets.filter(t => t.status === 'READY'),
      totalActiveTickets: tickets.length,
      tickets
    };

    res.json(grouped);
  } catch (err) {
    console.error('Fetch kitchen tickets error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// PUT /api/kitchen/tickets/:id/advance
// Progresses ticket to the next stage: PENDING -> PREPARING -> READY -> SERVED
router.put('/tickets/:id/advance', async (req, res) => {
  const { id: orderId } = req.params;

  if (!orderId || orderId === 'undefined' || orderId === 'null') {
    return res.status(400).json({ error: 'Valid Order ID is required' });
  }

  try {
    const orderRes = await db.query('SELECT id, status, table_id, restaurant_id FROM orders WHERE id = $1', [orderId]);
    if (orderRes.rowCount === 0) return res.status(404).json({ error: 'Order not found' });

    const currentStatus = orderRes.rows[0].status;
    let nextStatus;

    switch (currentStatus) {
      case 'PENDING':
        nextStatus = 'PREPARING';
        break;
      case 'PREPARING':
        nextStatus = 'READY';
        break;
      case 'READY':
        nextStatus = 'SERVED';
        break;
      default:
        return res.status(400).json({ error: `Cannot advance an order with status: ${currentStatus}` });
    }

    const updateRes = await db.query(
      `UPDATE orders 
       SET status = $1, updated_at = now() 
       WHERE id = $2 
       RETURNING id, table_id, status, total, updated_at`,
      [nextStatus, orderId]
    );

    const updatedOrder = updateRes.rows[0];

    // Emit real-time kitchen broadcast with audio chime trigger
    try {
      const io = getIO();
      const advancePayload = {
        orderId,
        tableId: updatedOrder.table_id,
        previousStatus: currentStatus,
        newStatus: nextStatus,
        status: nextStatus,
        playChime: nextStatus === 'READY' // Alert runner/waiter that food is ready for delivery
      };
      io.emit('kitchen:ticket_advanced', advancePayload);
      io.emit('order:status_updated', advancePayload);
      io.to(`table_${updatedOrder.table_id}`).emit('order:update', {
        orderId,
        status: nextStatus
      });
    } catch (e) {
      console.warn('Socket emit warning:', e.message);
    }

    res.json({
      message: `Order transitioned from ${currentStatus} to ${nextStatus}`,
      order: updatedOrder
    });
  } catch (err) {
    console.error('Advance ticket error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;

