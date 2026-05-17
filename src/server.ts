import express, {} from 'express';
import cors from 'cors';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { Webhook } from 'standardwebhooks';
import { PrismaClient } from './generated/prisma/client.js'

dotenv.config({ path: 'then.env' });

const app = express();
const prisma = new PrismaClient();

app.use(express.json());
app.use(cors({ origin: '*' }));

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;
const DODO_WEBHOOK_SECRET = process.env.DODO_WEBHOOK_SECRET!;
const SMTP_SENDER_EMAIL = process.env.SMTP_SENDER_EMAIL;
const SMTP_SENDER_PASSWORD = process.env.SMTP_SENDER_PASSWORD;
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
const PORT = process.env.PORT || 3000;

const MAX_FREE_USES = 5;
const MAX_VERIFIED_FREE_USES = 10;
const VERIFICATION_CODE_TTL_MINUTES = 15;

const transporter = SMTP_SENDER_EMAIL && SMTP_SENDER_PASSWORD
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: {
        user: SMTP_SENDER_EMAIL,
        pass: SMTP_SENDER_PASSWORD,
      },
    })
  : null;

if (!transporter) {
  console.warn('SMTP is not configured. License delivery emails will be skipped.');
}

const webhook = new Webhook(DODO_WEBHOOK_SECRET);

// ── TRANSLATE ─────────────────────────────────────────────
app.post('/translate', async (req, res) => {
  const { text, installId } = req.body as { text: string; installId: string };

  if (!installId) {
    res.status(400).json({ error: 'Missing installId.' });
    return;
  }
  if (!text || text.length < 10) {
    res.status(400).json({ error: 'Post text too short.' });
    return;
  }
  if (text.length > 3000) {
    res.status(400).json({ error: 'Post text too long.' });
    return;
  }

  try {
    const trial = await getOrCreateInstallTrial(installId);
    const allowedUses = trial.verified ? MAX_VERIFIED_FREE_USES : MAX_FREE_USES;

    if (trial.freeUses >= allowedUses) {
      res.status(403).json({ error: 'TRIAL_LIMIT_REACHED', requiresVerification: !trial.verified });
      return;
    }

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

    const data = await response.json() as any;
    const translation = data.choices?.[0]?.message?.content?.trim();
    if (!translation) throw new Error('No translation generated');

    const updatedTrial = await prisma.installTrial.update({
      where: { installId },
      data: { freeUses: { increment: 1 } }
    });

    res.json({
      translation,
      freeUses: updatedTrial.freeUses,
      verified: updatedTrial.verified,
      maxFreeUses: updatedTrial.verified ? MAX_VERIFIED_FREE_USES : MAX_FREE_USES,
    });
  } catch (err) {
    console.error('Translation error:', err);
    res.status(500).json({ error: 'Translation failed. Try again.' });
  }
});

// ── VERIFY LICENSE ────────────────────────────────────────
app.post('/verify-license', async (req, res) => {
  const { key } = req.body as { key: string };

  if (!key) {
    res.status(400).json({ valid: false, message: 'No key provided.' });
    return;
  }

  try {
    const license = await prisma.license.findUnique({
      where: { key: key.trim().toUpperCase() }
    });

    if (!license || !license.active) {
      res.json({ valid: false, message: 'Invalid or deactivated license key.' });
      return;
    }

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

async function getOrCreateInstallTrial(installId: string) {
  return prisma.installTrial.upsert({
    where: { installId },
    create: { installId },
    update: {},
  });
}

function makeVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendVerificationCodeEmail(to: string, code: string) {
  if (!transporter || !SMTP_SENDER_EMAIL) {
    console.warn('Skipping verification email because SMTP is not configured. Code:', code);
    return;
  }

  const message = {
    from: SMTP_SENDER_EMAIL,
    to,
    subject: 'Your LinkedIn Translator verification code',
    text: `Your verification code is ${code}. It expires in ${VERIFICATION_CODE_TTL_MINUTES} minutes.`,
    html: `<p>Your verification code is <strong>${code}</strong>.</p><p>It expires in ${VERIFICATION_CODE_TTL_MINUTES} minutes.</p>`,
  };

  await transporter.sendMail(message);
}

app.get('/trial-status', async (req, res) => {
  const installId = String(req.query.installId || '');
  if (!installId) {
    res.status(400).json({ error: 'installId is required.' });
    return;
  }

  try {
    const trial = await getOrCreateInstallTrial(installId);
    res.json({ freeUses: trial.freeUses, verified: trial.verified, maxFreeUses: trial.verified ? MAX_VERIFIED_FREE_USES : MAX_FREE_USES });
  } catch (err) {
    console.error('Trial status error:', err);
    res.status(500).json({ error: 'Could not load trial status.' });
  }
});

app.post('/start-trial-verification', async (req, res) => {
  const { installId, email } = req.body as { installId: string; email: string };
  if (!installId || !email) {
    res.status(400).json({ error: 'installId and email are required.' });
    return;
  }

  try {
    const trial = await getOrCreateInstallTrial(installId);
    const code = makeVerificationCode();
    const expires = new Date(Date.now() + VERIFICATION_CODE_TTL_MINUTES * 60 * 1000);

    await prisma.installTrial.update({
      where: { installId },
      data: {
        email,
        verificationCode: code,
        codeExpires: expires,
      }
    });

    await sendVerificationCodeEmail(email, code);
    res.json({ success: true, message: 'Verification code sent to your email.' });
  } catch (err) {
    console.error('Start verification error:', err);
    res.status(500).json({ error: 'Could not start verification.' });
  }
});

app.post('/verify-trial-code', async (req, res) => {
  const { installId, code } = req.body as { installId: string; code: string };
  if (!installId || !code) {
    res.status(400).json({ error: 'installId and code are required.' });
    return;
  }

  try {
    const trial = await prisma.installTrial.findUnique({ where: { installId } });
    if (!trial || !trial.verificationCode || !trial.codeExpires) {
      res.status(400).json({ error: 'No verification request found.' });
      return;
    }

    if (trial.codeExpires < new Date()) {
      res.status(400).json({ error: 'Verification code expired.' });
      return;
    }

    if (String(code).trim() !== trial.verificationCode) {
      res.status(400).json({ error: 'Invalid verification code.' });
      return;
    }

    await prisma.installTrial.update({
      where: { installId },
      data: { verified: true, verificationCode: null, codeExpires: null },
    });

    res.json({ success: true, verified: true, maxFreeUses: MAX_VERIFIED_FREE_USES });
  } catch (err) {
    console.error('Verify trial code error:', err);
    res.status(500).json({ error: 'Could not verify code.' });
  }
});

// ── DODO WEBHOOK ──────────────────────────────────────────
app.post('/webhook/dodo', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body.toString('utf8')
      : typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

    const webhookHeaders = {
      'webhook-id': req.headers['webhook-id'] as string || '',
      'webhook-signature': req.headers['webhook-signature'] as string || '',
      'webhook-timestamp': req.headers['webhook-timestamp'] as string || '',
    };

    console.log('Webhook headers:', webhookHeaders);
    console.log('Webhook body:', rawBody);

    // Verify the webhook signature
    await webhook.verify(rawBody, webhookHeaders);
    
    const event = JSON.parse(rawBody) as any;
    console.log('Dodo webhook event:', event.type);

    if (event.type === 'payment.succeeded' || event.type === 'order.paid') {
      const email = event.data?.customer?.email as string | undefined;
      const licenseKey = generateLicenseKey();
      console.log(`Creating license for ${email || 'unknown email'} with key ${licenseKey}`);
      try {
        await prisma.license.create({
          data: { key: licenseKey, email: email ?? 'unknown' }
        });
        console.log(`License created: ${licenseKey} for ${email || 'unknown'}`);
        if (email) {
          await sendLicenseEmail(email, licenseKey);
        } else {
          console.warn('No customer email found on webhook event; skipping license email.');
        }
      } catch (err) {
        console.error('Failed to create license:', err);
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook verification failed:', err);
    res.status(401).json({ error: 'Webhook verification failed' });
  }
});
async function sendLicenseEmail(to: string, licenseKey: string) {
  if (!transporter || !SMTP_SENDER_EMAIL) {
    console.warn('Skipping license email because SMTP is not configured.');
    return;
  }

  const message = {
    from: SMTP_SENDER_EMAIL,
    to,
    subject: 'Your LinkedIn Translator License Key',
    text: `Thanks for your purchase!\n\nYour license key is:\n\n${licenseKey}\n\nUse this key to verify your license.`,
    html: `<p>Thanks for your purchase!</p><p>Your license key is:</p><h2>${licenseKey}</h2><p>Use this key to verify your license.</p>`,
  };

  try {
    await transporter.sendMail(message);
    console.log(`License email sent to ${to}`);
  } catch (err) {
    console.error('Failed to send license email:', err);
  }
}
// ── HEALTH ────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── UTILS ─────────────────────────────────────────────────
function generateLicenseKey(): string {
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