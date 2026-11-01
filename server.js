const express = require('express');
const http = require('http');
const cors = require('cors');
const dotenv = require('dotenv');
const { initSocket } = require('./socket');

// Load environment variables
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Import routes
const menuRoutes = require('./routes/menu');
const orderRoutes = require('./routes/order');
const adminRoutes = require('./routes/admin');
const qrRoutes = require('./routes/qr');
const kitchenRoutes = require('./routes/kitchen');

app.use('/api/menu', menuRoutes);
app.use('/api/order', orderRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/qr', qrRoutes);
app.use('/api/kitchen', kitchenRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Create HTTP server & bind Socket.IO
const server = http.createServer(app);
const io = initSocket(server);

const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.log(`🚀 Restaurant QR Backend listening on port ${PORT}`);
  });
}

module.exports = { app, server, io };
