const express = require('express');
const http = require('http');
const cors = require('cors');
const dotenv = require('dotenv');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { initSocket } = require('./socket');
const db = require('./db');

// Load environment variables
dotenv.config();

const app = express();

// Security HTTP headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

app.use(cors());
app.use(express.json());

// Rate Limiting (Protects API & prevents brute-force on login in production/development)
if (process.env.NODE_ENV !== 'test') {
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests from this IP, please try again later.' }
  });
  app.use('/api/', apiLimiter);

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Too many login attempts, please try again after 15 minutes.' }
  });
  app.use('/api/admin/login', loginLimiter);
}

// Import routes
const menuRoutes = require('./routes/menu');
const orderRoutes = require('./routes/order');
const adminRoutes = require('./routes/admin');
const qrRoutes = require('./routes/qr');
const kitchenRoutes = require('./routes/kitchen');
const { swaggerUi, swaggerDocument } = require('./docs/swagger');

app.use('/api/menu', menuRoutes);
app.use('/api/order', orderRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/qr', qrRoutes);
app.use('/api/kitchen', kitchenRoutes);

// Interactive OpenAPI / Swagger Documentation
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Health check endpoint
app.get(['/health', '/api/health'], (req, res) => {
  res.json({
    status: 'ok',
    security: 'helmet_enabled',
    timestamp: new Date().toISOString()
  });
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

// Graceful shutdown
const shutdown = (signal) => {
  console.log(`${signal} signal received: closing HTTP server and database pool...`);
  server.close(() => {
    db.pool.end(() => {
      console.log('Database connections terminated. Process terminated cleanly.');
      process.exit(0);
    });
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, server, io };
