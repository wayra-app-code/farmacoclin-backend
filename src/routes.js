const express = require('express');
const { getDrugInteractions, searchDrugs } = require('./openfda');
const { analyzeInteractions, translateDrugsToEnglish, suggestPrescription } = require('./claude');

const router = express.Router();

// POST /analyze
// Body: { diseases: string[], drugs: string[] }
router.post('/analyze', async (req, res) => {
  const { diseases, drugs } = req.body;

  if (!diseases?.length || !drugs?.length) {
    return res.status(400).json({ error: 'Indica pelo menos uma doença e um medicamento.' });
  }
  if (drugs.length > 15) {
    return res.status(400).json({ error: 'Máximo de 15 medicamentos por análise.' });
  }

  try {
    // Translate drug names to English for OpenFDA
    const translatedDrugs = await translateDrugsToEnglish(drugs);

    // Fetch drug data from OpenFDA in parallel
    const drugData = await Promise.all(translatedDrugs.map((drug) => getDrugInteractions(drug)));

    // Send to Claude for analysis (pass original names for display)
    const analysis = await analyzeInteractions({
      diseases,
      drugs: translatedDrugs,
      originalDrugs: drugs,
      drugData,
    });

    res.json({
      diseases,
      drugs,
      translatedDrugs,
      analysis,
      drugsFound: drugData.filter(Boolean).map((d) => d.brand || d.name),
      drugsNotFound: translatedDrugs.filter(
        (name) => !drugData.find((d) => d?.name?.toLowerCase() === name.toLowerCase())
      ),
    });
  } catch (err) {
    console.error('Analyze error:', err.message);
    res.status(500).json({ error: 'Erro ao analisar interações. Tenta novamente.' });
  }
});

// POST /prescribe
// Body: { diseases: string[], allergies?: string[], currentMeds?: string[] }
router.post('/prescribe', async (req, res) => {
  const { diseases, allergies, currentMeds } = req.body;

  if (!diseases?.length) {
    return res.status(400).json({ error: 'Indica pelo menos uma doença ou condição.' });
  }

  try {
    const suggestion = await suggestPrescription({ diseases, allergies, currentMeds });
    res.json({ diseases, allergies, currentMeds, suggestion });
  } catch (err) {
    console.error('Prescribe error:', err.message);
    res.status(500).json({ error: 'Erro ao gerar sugestão. Tenta novamente.' });
  }
});

// GET /search?q=aspirin
router.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json([]);

  try {
    const results = await searchDrugs(q);
    res.json(results);
  } catch {
    res.json([]);
  }
});

// GET /health
router.get('/health', (_req, res) => res.json({ status: 'ok' }));

module.exports = router;
