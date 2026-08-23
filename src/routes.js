const express = require('express');
const { getDrugInteractions, searchDrugs } = require('./openfda');
const { analyzeInteractions, translateDrugsToEnglish, suggestPrescription } = require('./claude');
const { generateToken, authMiddleware, usageLimitMiddleware, getUsageToday, FREE_DAILY_LIMIT, bcrypt, db } = require('./auth');
const { createCheckoutSession, handleWebhook } = require('./stripe');

const router = express.Router();

// --- AUTH ---

router.post('/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email e password obrigatórios.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password deve ter pelo menos 6 caracteres.' });
  try {
    const hashed = await bcrypt.hash(password, 10);
    const user = db.prepare('INSERT INTO users (email, password) VALUES (?, ?) RETURNING id, email, plan')
      .get(email.toLowerCase().trim(), hashed);
    res.json({ token: generateToken(user), user: { email: user.email, plan: user.plan } });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email já registado.' });
    res.status(500).json({ error: 'Erro ao criar conta.' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email e password obrigatórios.' });
  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ error: 'Email ou password incorrectos.' });
    const used = getUsageToday(user.id);
    res.json({
      token: generateToken(user),
      user: { email: user.email, plan: user.plan, usedToday: used, limit: FREE_DAILY_LIMIT },
    });
  } catch {
    res.status(500).json({ error: 'Erro ao fazer login.' });
  }
});

router.get('/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT email, plan FROM users WHERE id = ?').get(req.user.id);
  const used = getUsageToday(req.user.id);
  res.json({ ...user, usedToday: used, limit: FREE_DAILY_LIMIT });
});

// --- STRIPE ---

router.post('/stripe/checkout', authMiddleware, async (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const url = await createCheckoutSession(user);
    res.json({ url });
  } catch (err) {
    console.error('Stripe checkout error:', err.message);
    res.status(500).json({ error: 'Erro ao criar sessão de pagamento.' });
  }
});

router.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const result = await handleWebhook(req.body, req.headers['stripe-signature']);
    res.json(result);
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// --- ANALYZE (protegido) ---

router.post('/analyze', authMiddleware, usageLimitMiddleware, async (req, res) => {
  const { diseases, drugs, language } = req.body;
  if (!diseases?.length || !drugs?.length)
    return res.status(400).json({ error: 'Indica pelo menos uma doença e um medicamento.' });
  if (drugs.length > 15)
    return res.status(400).json({ error: 'Máximo de 15 medicamentos por análise.' });

  try {
    const translatedDrugs = await translateDrugsToEnglish(drugs);
    const drugData = await Promise.all(translatedDrugs.map((drug) => getDrugInteractions(drug)));
    const analysis = await analyzeInteractions({ diseases, drugs: translatedDrugs, originalDrugs: drugs, drugData, language });

    const used = getUsageToday(req.user.id);
    res.json({
      diseases, drugs, translatedDrugs, analysis,
      drugsFound: drugData.filter(Boolean).map((d) => d.brand || d.name),
      drugsNotFound: translatedDrugs.filter(
        (name) => !drugData.find((d) => d?.name?.toLowerCase() === name.toLowerCase())
      ),
      usedToday: used,
      limit: req.user.plan === 'premium' ? null : FREE_DAILY_LIMIT,
      plan: req.user.plan,
    });
  } catch (err) {
    console.error('Analyze error:', err.message);
    res.status(500).json({ error: 'Erro ao analisar interações. Tenta novamente.', detail: err.message });
  }
});

router.post('/prescribe', authMiddleware, usageLimitMiddleware, async (req, res) => {
  const { diseases, allergies, currentMeds, language } = req.body;
  if (!diseases?.length)
    return res.status(400).json({ error: 'Indica pelo menos uma doença ou condição.' });

  try {
    const suggestion = await suggestPrescription({ diseases, allergies, currentMeds, language });
    const used = getUsageToday(req.user.id);
    res.json({
      diseases, allergies, currentMeds, suggestion,
      usedToday: used,
      limit: req.user.plan === 'premium' ? null : FREE_DAILY_LIMIT,
      plan: req.user.plan,
    });
  } catch (err) {
    console.error('Prescribe error:', err.message);
    res.status(500).json({ error: 'Erro ao gerar sugestão. Tenta novamente.', detail: err.message });
  }
});

router.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json([]);
  try {
    res.json(await searchDrugs(q));
  } catch {
    res.json([]);
  }
});

router.get('/health', (_req, res) => res.json({ status: 'ok' }));

module.exports = router;
