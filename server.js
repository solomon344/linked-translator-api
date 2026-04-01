import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const app = express();
const prisma = new PrismaClient();

app.use(express.json());
app.use(cors({ origin: '*' }));

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const DODO_WEBHOOK_SECRET = process.env.DODO_WEBHOOK_SECRET;
const PORT = process.env.PORT || 3000;

// ── TRANSLATE ─────────────────────────────────────────────
app.post('/translate', async (req, res) => {
  const { text } = req.body;

  if (!text || text.length < 10) return res.status(400).json({ error: 'Post text too short.' });
  if (text.length > 3000) return res.status(400).json({ error: 'Post text too long.' });

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://linkedin-translator.com',
        'X-Title': 'LinkedIn Translator'
      },
      body: JSON.stringify({
        model: 'anthropic/claude-3-5-haiku',
        max_tokens: 300,
        messages: [
          {
            role: 'system',
            content: `You are a brutally honest LinkedIn translator. Read corporate LinkedIn posts and translate them into what the author is ACTUALLY saying — the real truth behind the professional-speak, humble-bragging, and performative vulnerability.

Rules:
- Be savage but accurate, not just mean
- Keep translations under 3 sentences
- Use casual, plain language — like texting a friend
- Don't add disclaimers or caveats
- Don't start with "Translation:" or any label
- Just give the raw translation directly

Examples:
- "Excited to share that after much reflection, I've decided to pursue new opportunities..." → "I got laid off and I'm putting a positive spin on it before my LinkedIn connections find out."
- "Grateful to announce I'll be joining [Big Company] as VP of Something..." → "I finally got a fancy title and I'm milking this announcement for every LinkedIn dopamine hit I can get."
- "Leadership is about showing up even when it's hard..." → "I had a bad week and I'm pretending it's a lesson."`
          },
          {
            role: 'user',
            content: `Translate this LinkedIn post:\n\n"${text}"`
          }
        ]
      })
    });

    const data = await response.json();
    const translation = data.choices?.[0]?.message?.content?.trim();
    if (!translation) throw new Error('No translation generated');

    res.json({ translation });
  } catch (err) {
    console.error('Translation error:', err);
    res.status(500).json({ error: 'Translation failed. Try again.' });
  }
});

// ── VERIFY LICENSE ────────────────────────────────────────
app.post('/verify-license', async (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ valid: false, message: 'No key provided.' });

  try {
    const license = await prisma.license.findUnique({
      where: { key: key.trim().toUpperCase() }
    });

    if (!license || !license.active) {
      return res.json({ valid: false, message: 'Invalid or deactivated license key.' });
    }

    // Record first activation time
    if (!license.activatedAt) {
      await prisma.license.update({
        where: { key: license.key },
        data: { activatedAt: new Date() }
      });
    }

    res.json({ valid: true });
  } catch (err) {
    console.error('License verify error:', err);
    res.status(500).json({ valid: false, message: 'Could not verify license.' });
  }
});

// ── DODO WEBHOOK ──────────────────────────────────────────
app.post('/webhook/dodo', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['webhook-signature'] || req.headers['x-dodo-signature'];

  if (DODO_WEBHOOK_SECRET && signature) {
    const expected = crypto
      .createHmac('sha256', DODO_WEBHOOK_SECRET)
      .update(req.body)
      .digest('hex');

    if (signature !== expected) {
      console.warn('Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const event = JSON.parse(req.body.toString());
  console.log('Dodo webhook event:', event.type);

  if (event.type === 'payment.succeeded' || event.type === 'order.paid') {
    const email = event.data?.customer?.email;
    const licenseKey = generateLicenseKey();

    try {
      await prisma.license.create({
        data: { key: licenseKey, email: email || 'unknown' }
      });

      console.log(`License created: ${licenseKey} for ${email}`);
      // TODO: send email with licenseKey to email using Resend
    } catch (err) {
      console.error('Failed to create license:', err);
    }
  }

  res.json({ received: true });
});

// ── HEALTH CHECK ──────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── UTILS ─────────────────────────────────────────────────
function generateLicenseKey() {
  const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${part()}-${part()}-${part()}-${part()}`;
}

// ── START ─────────────────────────────────────────────────
async function main() {
  await prisma.$connect();
  console.log('Connected to database');
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

main().catch(err => {
  console.error('Startup error:', err);
  process.exit(1);
});
