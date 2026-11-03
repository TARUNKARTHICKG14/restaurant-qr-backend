// middleware/auth.js
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';

/**
 * Express middleware that verifies a JWT passed in the Authorization header.
 * Header format: "Authorization: Bearer <token>".
 * On success, attaches `req.user` (payload) and calls next().
 * On failure, responds with 401.
 */
function verifyToken(req, res, next) {
  let token;
  const authHeader = req.headers['authorization'];
  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      token = parts[1];
    } else {
      return res.status(401).json({ error: 'Invalid Authorization format' });
    }
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // e.g., { adminId, email }
    next();
  } catch (err) {
    console.error('JWT verification error:', err);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Helper to issue a JWT for a given payload.
 * Used by a simple login endpoint (email + password static for demo).
 */
function issueToken(payload) {
  // token valid for 7 days
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

module.exports = { verifyToken, issueToken };

