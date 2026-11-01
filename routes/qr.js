const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const db = require('../db');

// GET /api/qr/restaurant/:restaurantId/bulk
// Returns QR codes for ALL tables in a restaurant for batch printing table stands/stickers
router.get('/restaurant/:restaurantId/bulk', async (req, res) => {
  const { restaurantId } = req.params;
  const clientBaseUrl = process.env.CLIENT_URL || process.env.BASE_URL || 'http://localhost:3000';

  try {
    const restRes = await db.query('SELECT id, name FROM restaurants WHERE id = $1', [restaurantId]);
    if (restRes.rowCount === 0) return res.status(404).json({ error: 'Restaurant not found' });

    const tablesRes = await db.query('SELECT * FROM tables WHERE restaurant_id = $1 ORDER BY number ASC', [restaurantId]);
    const tables = tablesRes.rows;

    const bulkQrs = await Promise.all(
      tables.map(async (table) => {
        const orderUrl = `${clientBaseUrl}/order?tableId=${table.id}&tableNumber=${table.number}`;
        const qrDataUrl = await QRCode.toDataURL(orderUrl, {
          width: 500,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' }
        });
        return {
          tableId: table.id,
          tableNumber: table.number,
          orderUrl,
          qrCodeDataUrl: qrDataUrl
        };
      })
    );

    res.json({
      restaurant: restRes.rows[0],
      totalTables: bulkQrs.length,
      tables: bulkQrs
    });
  } catch (err) {
    console.error('Bulk QR generation error:', err);
    res.status(500).json({ error: 'Failed to generate bulk QR codes' });
  }
});

// GET /api/qr/:tableId
// Generates high-res PNG, SVG, or JSON QR codes with custom size, colors and download headers
router.get('/:tableId', async (req, res) => {
  const { tableId } = req.params;
  const { format = 'png', size = 400, dark = '#000000', light = '#ffffff', download } = req.query;

  try {
    const tableRes = await db.query('SELECT * FROM tables WHERE id = $1', [tableId]);
    if (tableRes.rowCount === 0) {
      return res.status(404).json({ error: 'Table not found' });
    }

    const table = tableRes.rows[0];
    const clientBaseUrl = process.env.CLIENT_URL || process.env.BASE_URL || 'http://localhost:3000';
    const orderUrl = `${clientBaseUrl}/order?tableId=${table.id}&tableNumber=${table.number}`;
    const qrWidth = Math.min(Math.max(parseInt(size, 10) || 400, 150), 2000);

    const qrOptions = {
      width: qrWidth,
      margin: 2,
      color: {
        dark: dark.startsWith('#') ? dark : `#${dark}`,
        light: light.startsWith('#') ? light : `#${light}`
      }
    };

    // 1. JSON payload with Data URL
    if (format === 'json') {
      const dataUrl = await QRCode.toDataURL(orderUrl, qrOptions);
      return res.json({
        tableId: table.id,
        tableNumber: table.number,
        targetUrl: orderUrl,
        size: qrWidth,
        qrCodeDataUrl: dataUrl
      });
    }

    // 2. Vector SVG format
    if (format === 'svg') {
      const svgString = await QRCode.toString(orderUrl, { ...qrOptions, type: 'svg' });
      res.setHeader('Content-Type', 'image/svg+xml');
      if (download === 'true') {
        res.setHeader('Content-Disposition', `attachment; filename="table-${table.number}-qr.svg"`);
      }
      return res.send(svgString);
    }

    // 3. High-Res PNG Stream (Default)
    res.setHeader('Content-Type', 'image/png');
    if (download === 'true') {
      res.setHeader('Content-Disposition', `attachment; filename="table-${table.number}-qr.png"`);
    }
    await QRCode.toFileStream(res, orderUrl, qrOptions);
  } catch (err) {
    console.error('QR generation error:', err);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

module.exports = router;
