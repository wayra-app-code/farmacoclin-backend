const express = require('express');
const { getDrugInteractions, searchDrugs } = require('./openfda');
const { analyzeInteractions, translateDrugsToEnglish, suggestPrescription } = require('./claude');

const router = express.Router();

router.post('/analyze', async (req, res) => {
  const { diseases, drugs, language } = req.body;
  if (!diseases?.length || !drugs?.length)
    return res.status(400).json({ error: 'Indica pelo menos uma doença e um medicamento.' });
  if (drugs.length > 15)
    return res.status(400).json({ error: 'Máximo de 15 medicamentos por análise.' });

  try {
    const translatedDrugs = await translateDrugsToEnglish(drugs);
    const drugData = await Promise.all(translatedDrugs.map((drug) => getDrugInteractions(drug)));
    const analysis = await analyzeInteractions({ diseases, drugs: translatedDrugs, originalDrugs: drugs, drugData, language });

    res.json({
      diseases, drugs, translatedDrugs, analysis,
      drugsFound: drugData.filter(Boolean).map((d) => d.brand || d.name),
      drugsNotFound: translatedDrugs.filter(
        (name) => !drugData.find((d) => d?.name?.toLowerCase() === name.toLowerCase())
      ),
    });
  } catch (err) {
    console.error('Analyze error:', err.message);
    res.status(500).json({ error: 'Erro ao analisar interações. Tenta novamente.', detail: err.message });
  }
});

router.post('/prescribe', async (req, res) => {
  const { diseases, allergies, currentMeds, language } = req.body;
  if (!diseases?.length)
    return res.status(400).json({ error: 'Indica pelo menos uma doença ou condição.' });

  try {
    const suggestion = await suggestPrescription({ diseases, allergies, currentMeds, language });
    res.json({ diseases, allergies, currentMeds, suggestion });
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

router.get('/debug-env', (_req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  res.json({
    hasKey: !!key,
    keyStart: key ? key.substring(0, 10) + '...' : 'NOT SET',
    keyLength: key ? key.length : 0,
  });
});

module.exports = router;
