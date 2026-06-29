const axios = require('axios');

const OPENFDA_BASE = 'https://api.fda.gov/drug';

// Search drug interactions from OpenFDA drug label endpoint
async function getDrugInteractions(drugName) {
  try {
    const response = await axios.get(`${OPENFDA_BASE}/label.json`, {
      params: {
        search: `openfda.brand_name:"${drugName}" OR openfda.generic_name:"${drugName}"`,
        limit: 1,
      },
      timeout: 8000,
    });

    const result = response.data.results?.[0];
    if (!result) return null;

    return {
      name: drugName,
      brand: result.openfda?.brand_name?.[0] || drugName,
      generic: result.openfda?.generic_name?.[0] || drugName,
      interactions: result.drug_interactions?.[0] || null,
      warnings: result.warnings?.[0] || null,
      contraindications: result.contraindications?.[0] || null,
      indications: result.indications_and_usage?.[0] || null,
    };
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw new Error(`OpenFDA error for "${drugName}": ${err.message}`);
  }
}

// Search drug by partial name (autocomplete)
async function searchDrugs(query) {
  try {
    const response = await axios.get(`${OPENFDA_BASE}/label.json`, {
      params: {
        search: `openfda.brand_name:"${query}" OR openfda.generic_name:"${query}"`,
        limit: 10,
      },
      timeout: 8000,
    });

    const results = response.data.results || [];
    return results.map((r) => ({
      brand: r.openfda?.brand_name?.[0] || 'Unknown',
      generic: r.openfda?.generic_name?.[0] || 'Unknown',
    }));
  } catch {
    return [];
  }
}

module.exports = { getDrugInteractions, searchDrugs };
