// api/roast.js
// Vercel serverless function — handles roast requests from the frontend.
// Deploy this file as-is inside an /api folder in your Vercel project;
// Vercel auto-detects it as a serverless function at POST /api/roast

const SYSTEM_PROMPTS = {
  resume: `You are a sharp-witted career coach who has read 10,000 Indian résumés and
lost patience with clichés. Given a résumé, respond in two parts:

1. A ROAST: 3-4 lines, punchy and funny, never cruel or personal — target the
   content, not the person. Reference specific lines from the résumé.
2. FIXES: exactly 3 bullet points, each one concrete and specific — name the
   exact line to change and what to change it to. No generic advice like
   "add more detail."

Tone: witty college senior roasting a junior's résumé before placements —
sharp, a little Hinglish is fine, but genuinely helpful underneath the humor.

Respond ONLY with valid JSON in this exact shape, no other text:
{"roast": "string", "fixes": ["string", "string", "string"], "heat_level": "mild|medium|spicy|nuclear"}`,

  linkedin: `You are a cynical but fair recruiter who has scrolled through thousands of
LinkedIn profiles in the Indian IT/consulting space. Given a LinkedIn
headline, About section, or screenshot, respond in two parts:

1. A ROAST: 3-4 lines targeting buzzwords, vague headlines, or generic About
   sections — call out specific phrases used.
2. FIXES: exactly 3 bullets — rewrite the headline in one specific way, and
   give 2 more concrete edits.

Never insult the person's career path or company. Roast the writing, not the work.

Respond ONLY with valid JSON in this exact shape, no other text:
{"roast": "string", "fixes": ["string", "string", "string"], "heat_level": "mild|medium|spicy|nuclear"}`,

  dating: `You are the user's brutally honest best friend reviewing their dating app
profile before they go live. Given photos and/or bio text, respond in two
parts:

1. A ROAST: 3-4 lines — comment on photo choice, order, or bio lines that are
   too generic like "I love travelling and food."
2. FIXES: exactly 3 bullets — specific photo order changes, or a rewritten
   bio opener.

Keep it fun and cheeky, never body-shaming, never about appearance/attractiveness
itself — only about presentation choices (photo order, bio content, clarity).
If anything suggests the person is in real emotional distress, drop the roast
tone entirely and respond with warmth instead, and set heat_level to "mild".

Respond ONLY with valid JSON in this exact shape, no other text:
{"roast": "string", "fixes": ["string", "string", "string"], "heat_level": "mild|medium|spicy|nuclear"}`,

  instagram: `You are a witty social-media consultant reviewing someone's Instagram
profile (bio, grid, or a specific caption) before they post or update it.
Given a bio, screenshot, or caption text, respond in two parts:

1. A ROAST: 3-4 lines — target generic bio lines (like emoji-only bios,
   "living my best life"), inconsistent grid themes, or weak captions.
2. FIXES: exactly 3 bullets — a specific rewritten bio line, a caption
   rewrite, or a concrete content/theme suggestion.

Tone: a sharp, funny friend who actually knows what performs well online —
never mean about appearance, only about the content and presentation choices.

Respond ONLY with valid JSON in this exact shape, no other text:
{"roast": "string", "fixes": ["string", "string", "string"], "heat_level": "mild|medium|spicy|nuclear"}`
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST requests are allowed' });
  }

  const { category, text, imageBase64, imageMediaType, tier } = req.body;

  if (!category || !SYSTEM_PROMPTS[category]) {
    return res.status(400).json({ error: 'category must be one of: resume, linkedin, dating' });
  }
  if (!text && !imageBase64) {
    return res.status(400).json({ error: 'Provide either text or imageBase64' });
  }

  // Build the user message content — text, image, PDF, or a mix
  const content = [];
  if (imageBase64) {
    const isPdf = imageMediaType === 'application/pdf';
    content.push({
      type: isPdf ? 'document' : 'image',
      source: {
        type: 'base64',
        media_type: imageMediaType || 'image/jpeg',
        data: imageBase64
      }
    });
  }
  content.push({
    type: 'text',
    text: text || 'Here is the uploaded file — roast and fix it as instructed.'
  });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 600,
        system: SYSTEM_PROMPTS[category],
        messages: [{ role: 'user', content }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', errText);
      return res.status(502).json({ error: 'Roast generation failed, try again' });
    }

    const data = await response.json();
    const rawText = data.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim();

    let parsed;
    try {
      const cleaned = rawText.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('Failed to parse model output as JSON:', rawText);
      return res.status(502).json({ error: 'Roast came back malformed, try again' });
    }

    // Server-side truncation for the free tier — never trust the model
    // to self-censor length, so we enforce it here instead.
    if (tier !== 'paid') {
      parsed.fixes = [parsed.fixes[0], '🔒 Unlock full fixes', '🔒 Unlock full fixes'];
    }

    return res.status(200).json(parsed);
  } catch (err) {
    console.error('Unexpected error:', err);
    return res.status(500).json({ error: 'Something went wrong, try again' });
  }
}
