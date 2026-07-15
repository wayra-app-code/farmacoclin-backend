const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Translates drug names to English for OpenFDA lookup
async function translateDrugsToEnglish(drugs) {
  const prompt = `Translates the following drug/medication names to their standard English generic names used in medical databases like OpenFDA. Return ONLY a JSON array of strings with the translated names, in the same order as the input. If a name is already in English or is a known brand name, keep it as-is. Do not explain anything.

Input: ${JSON.stringify(drugs)}

Output (JSON array only):`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
  });

  try {
    const text = message.content[0].text.trim();
    const json = text.match(/\[.*\]/s)?.[0];
    return JSON.parse(json);
  } catch {
    return drugs; // fallback to original if parse fails
  }
}

const LANG_INSTRUCTIONS = {
  pt: 'Responde em português europeu, de forma clara e estruturada.',
  en: 'Respond in English, clearly and in a structured manner.',
  fr: 'Réponds en français, de manière claire et structurée.',
  es: 'Responde en español, de forma clara y estructurada.',
};

async function analyzeInteractions({ diseases, drugs, drugData, originalDrugs, language = 'pt' }) {
  const drugsWithData = drugData.filter((d) => d !== null);
  const drugsNotFound = drugs.filter(
    (name) => !drugData.find((d) => d?.name?.toLowerCase() === name.toLowerCase())
  );

  const drugSummary = drugsWithData
    .map(
      (d) =>
        `**${d.brand} (${d.generic})**\n` +
        `- Interações conhecidas: ${d.interactions ? d.interactions.substring(0, 500) + '...' : 'Não disponível'}\n` +
        `- Contraindicações: ${d.contraindications ? d.contraindications.substring(0, 300) + '...' : 'Não disponível'}\n` +
        `- Avisos: ${d.warnings ? d.warnings.substring(0, 300) + '...' : 'Não disponível'}`
    )
    .join('\n\n');

  const prompt = `És um assistente médico especializado em farmacologia clínica. Analisa as seguintes informações e fornece uma análise clara e estruturada das interações medicamentosas.

**Doenças/condições do paciente:**
${diseases.join(', ')}

**Medicamentos a analisar:**
${(originalDrugs || drugs).join(', ')}

**Dados dos medicamentos (OpenFDA):**
${drugSummary || 'Dados não disponíveis via OpenFDA.'}

${drugsNotFound.length > 0 ? `**Medicamentos não encontrados na base de dados OpenFDA:** ${drugsNotFound.join(', ')}` : ''}

Por favor fornece:
1. **Interações entre medicamentos** — conflitos diretos entre os medicamentos listados
2. **Interações com as doenças** — medicamentos que podem agravar ou ser contraindicados para as condições listadas
3. **Nível de risco** — classifica cada interação como: 🔴 Alto / 🟡 Moderado / 🟢 Baixo
4. **Recomendações** — sugestões práticas para o médico
5. **Nota** — lembra que esta análise é de apoio à decisão e não substitui o julgamento clínico

${LANG_INSTRUCTIONS[language] || LANG_INSTRUCTIONS.pt}`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  return message.content[0].text;
}

async function suggestPrescription({ diseases, allergies, currentMeds, language = 'pt' }) {
  const prompt = `És um assistente médico especializado em farmacologia clínica e medicina interna. O médico precisa de apoio para decidir a medicação mais adequada para um paciente.

**Condições/doenças do paciente:**
${diseases.join(', ')}

${allergies?.length ? `**Alergias conhecidas:**\n${allergies.join(', ')}` : ''}

${currentMeds?.length ? `**Medicação atual do paciente:**\n${currentMeds.join(', ')}` : ''}

Por favor fornece uma sugestão de prescrição estruturada com:

1. **Medicamentos de primeira linha** — para cada condição, o tratamento farmacológico recomendado pelas guidelines clínicas atuais (com dose típica e frequência)
2. **Medicamentos de segunda linha** — alternativas caso a primeira linha seja contraindicada ou ineficaz
3. **Interações a vigiar** — se há medicamentos sugeridos que interagem entre si ou com a medicação atual
4. **Contraindicações** — medicamentos a EVITAR dadas as condições do paciente
5. **Monitorização recomendada** — análises, parâmetros ou consultas a agendar
6. **Nota clínica** — lembra que esta sugestão é de apoio à decisão e o médico deve adaptar ao contexto individual do paciente

${LANG_INSTRUCTIONS[language] || LANG_INSTRUCTIONS.pt}`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2500,
    messages: [{ role: 'user', content: prompt }],
  });

  return message.content[0].text;
}

module.exports = { analyzeInteractions, translateDrugsToEnglish, suggestPrescription };
