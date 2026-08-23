const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'farmacoclin-secret-change-in-prod';
const FREE_DAILY_LIMIT = 5;

function generateToken(user) {
  return jwt.sign({ id: user.id, email: user.email, plan: user.plan }, JWT_SECRET, { expiresIn: '30d' });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function getToday() {
  return new Date().toISOString().split('T')[0];
}

function getUsageToday(userId) {
  const row = db.prepare('SELECT count FROM usage WHERE user_id = ? AND date = ?').get(userId, getToday());
  return row?.count || 0;
}

function incrementUsage(userId) {
  const today = getToday();
  db.prepare(`
    INSERT INTO usage (user_id, date, count) VALUES (?, ?, 1)
    ON CONFLICT(user_id, date) DO UPDATE SET count = count + 1
  `).run(userId, today);
}

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Login necessário.' });
  try {
    req.user = verifyToken(token);
    // Refresh user plan from DB
    const user = db.prepare('SELECT plan FROM users WHERE id = ?').get(req.user.id);
    if (user) req.user.plan = user.plan;
    next();
  } catch {
    res.status(401).json({ error: 'Sessão expirada. Faz login novamente.' });
  }
}

function usageLimitMiddleware(req, res, next) {
  if (req.user.plan === 'premium') return next();
  const used = getUsageToday(req.user.id);
  if (used >= FREE_DAILY_LIMIT) {
    return res.status(429).json({
      error: 'Limite diário atingido.',
      limitReached: true,
      used,
      limit: FREE_DAILY_LIMIT,
    });
  }
  incrementUsage(req.user.id);
  next();
}

module.exports = {
  generateToken, verifyToken, authMiddleware, usageLimitMiddleware,
  getUsageToday, FREE_DAILY_LIMIT, bcrypt, db,
};
