const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const db = require('../db');

// GET /api/qr/:tableId
// Returns a PNG QR code that points to the customer table ordering web URL
router.get('/:tableId', async (req, res) => {
  const { tableId } = req.params;

  try {
    // Check if table exists in database
    const tableRes = await db.query('SELECT * FROM tables WHERE id = $1', [tableId]);
    if (tableRes.rowCount === 0) {
      return res.status(404).json({ error: 'Table not found' });
    }

    const table = tableRes.rows[0];
    const clientBaseUrl = process.env.CLIENT_URL || process.env.BASE_URL || 'http://localhost:3000';
    // Deep-link to table order page
    const orderUrl = `${clientBaseUrl}/order?tableId=${table.id}&tableNumber=${table.number}`;

    // If query format=json requested, return data URL and target URL
    if (req.query.format === 'json') {
      const dataUrl = await QRCode.toDataURL(orderUrl);
      return res.json({
        tableId: table.id,
        tableNumber: table.number,
        targetUrl: orderUrl,
        qrCodeDataUrl: dataUrl
      });
    }

    // Default: stream as image/png
    res.setHeader('Content-Type', 'image/png');
    await QRCode.toFileStream(res, orderUrl, {
      width: 400,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
  } catch (err) {
    console.error('QR generation error:', err);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

module.exports = router;

