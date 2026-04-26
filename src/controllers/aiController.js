const axios = require('axios');

const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';
const API_KEY = process.env.GOOGLE_GEMINI_API_KEY;

const _apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${API_KEY}`;

// @desc    Analyze a report using Gemini
// @route   POST /api/ai/analyze
// @access  Public (Should be Protected in prod)
const analyzeReport = async (req, res) => {
  const { title, description, category, zoneName, corroborations, disputes } = req.body;

  if (!API_KEY) {
    return res.status(503).json({ status: 'error', message: 'AI Service unconfigured' });
  }

  const prompt = `
You are CampusNexus AI — an analyst for a Nigerian campus safety platform.
Analyze this student-submitted report and respond ONLY with valid JSON.

REPORT:
- Title: "${title}"
- Description: "${description}"
- Category: ${category}
- Zone: ${zoneName}
- Corroborations: ${corroborations || 0}
- Disputes: ${disputes || 0}

SCORING CRITERIA:
1. sentiment_score (0-10): How urgent/concerning is this? 0=trivial, 10=emergency
2. credibility_score (0-10): How linguistically credible? Check for specificity, coherence, plausibility
3. ai_score (0-10): Combined AI assessment considering all factors
4. summary: One-sentence assessment
5. category: Best matching category from [security, infrastructure, health, academic, social, transport, environmental, general]
6. flags: Array of any applicable flags: ["urgent", "vague", "duplicate", "sensitive", "escalate"]

RESPOND WITH ONLY THIS JSON FORMAT:
{
  "sentiment_score": 7.2,
  "credibility_score": 6.5,
  "ai_score": 6.8,
  "summary": "Credible infrastructure concern requiring attention.",
  "category": "infrastructure",
  "flags": ["urgent"]
}`;

  try {
    const response = await axios.post(_apiUrl, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 512,
        responseMimeType: 'application/json',
      },
    });

    const data = response.data.candidates[0].content.parts[0].text;
    res.json({ status: 'success', data: JSON.parse(data) });
  } catch (error) {
    console.error('AI Analysis Error:', error.message);
    res.status(500).json({ status: 'error', message: 'AI Analysis Failed' });
  }
};

// @desc    Natural language campus chat
// @route   POST /api/ai/chat
// @access  Public
const queryChat = async (req, res) => {
  const { userQuery, activeReports, zones } = req.body;

  if (!API_KEY) {
    return res.status(503).json({ status: 'error', message: 'AI Service unconfigured' });
  }

  const reportSummary = (activeReports || []).slice(0, 20).map(r => 
    `- [${r.category}] ${r.title} (trust: ${r.finalTrustScore}, status: ${r.status})`
  ).join('\n');

  const zoneSummary = (zones || []).map(z => `- ${z.name}: status=${z.status}`).join('\n');

  const prompt = `
You are CampusNexus AI, the intelligent assistant for a Nigerian campus safety platform.
Answer the student's question using the current campus data below.
Be concise, helpful, and specific. If you don't have enough data, say so honestly.

ACTIVE REPORTS:
${reportSummary}

CAMPUS ZONES:
${zoneSummary}

STUDENT QUESTION: ${userQuery}

Respond naturally in 2-4 sentences. Be direct and actionable.`;

  try {
    const response = await axios.post(_apiUrl, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 300,
      },
    });

    const text = response.data.candidates[0].content.parts[0].text;
    res.json({ status: 'success', data: text.trim() });
  } catch (error) {
    console.error('AI Chat Error:', error.message);
    res.status(500).json({ status: 'error', message: 'AI Chat Failed' });
  }
};

module.exports = {
  analyzeReport,
  queryChat
};
