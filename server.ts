import express from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import QRCode from 'qrcode';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const PORT = 3000;
const app = express();

app.use(
  express.json({
    limit: '4mb',
  })
);

const APP_BASE_URL = process.env.APP_URL || process.env.VITE_APP_URL || `http://localhost:${PORT}`;
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'TapNex <orders@tapnex.in>';

// --- Health & Integration Status ---
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    integrations: {
      paymentAuthority: 'firebase-cloud-functions',
      resendConfigured: Boolean(RESEND_API_KEY),
      superAdminBootstrapEnabled: process.env.SUPERADMIN_BOOTSTRAP_ENABLED === 'true',
      appBaseUrl: APP_BASE_URL,
    },
  });
});

// --- Retired Legacy Express Payment Routes ---
app.all('/api/payments/*', (_req, res) => {
  return res.status(410).json({
    error:
      'Legacy /api/payments/* routes are retired. Payments are exclusively handled by Firebase Cloud Functions (createPaymentOrder, verifyPayment, razorpayWebhook).',
  });
});



// --- Server-Side QR Code Generator (High-Res PNG + SVG, Error Correction H, Quiet Zone) ---
app.post('/api/qr/generate', async (req, res) => {
  try {
    const { targetUrl, width = 1024 } = req.body as { targetUrl?: string; width?: number };
    if (!targetUrl || typeof targetUrl !== 'string') {
      return res.status(400).json({ error: 'Valid targetUrl is required.' });
    }
    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return res.status(400).json({ error: 'Target URL must use http or https.' });
      }
    } catch {
      return res.status(400).json({ error: 'Malformed targetUrl.' });
    }

    const safeWidth = Math.min(Math.max(Number(width) || 1024, 256), 2048);
    const svgContent = await QRCode.toString(parsed.toString(), {
      type: 'svg',
      errorCorrectionLevel: 'H',
      margin: 4,
      color: { dark: '#0B1D3A', light: '#FFFFFF' },
    });

    const pngDataUrl = await QRCode.toDataURL(parsed.toString(), {
      errorCorrectionLevel: 'H',
      margin: 4,
      width: safeWidth,
      color: { dark: '#0B1D3A', light: '#FFFFFF' },
    });

    return res.json({
      targetUrl: parsed.toString(),
      svgContent,
      pngDataUrl,
      errorCorrectionLevel: 'H',
      quietZoneModules: 4,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('QR generation failed:', err);
    return res.status(500).json({ error: 'Failed to generate QR artwork.' });
  }
});



// --- Transactional Email via Resend (Server-Side Only) ---
app.post('/api/email/send', async (req, res) => {
  try {
    const { to, subject, html } = req.body as { to?: string; subject?: string; html?: string };
    if (!to || !subject || !html) {
      return res.status(400).json({ error: 'to, subject, and html are required.' });
    }

    if (!RESEND_API_KEY) {
      return res.json({
        delivered: false,
        mode: 'unconfigured',
        missingCredential: 'RESEND_API_KEY',
        message: 'Resend API key is not configured. Email queued in notification log for preview.',
      });
    }

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: [to],
        subject,
        html,
      }),
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.text();
      return res.status(502).json({ delivered: false, error: 'Resend API error', details: errBody });
    }

    const data = await emailRes.json();
    return res.json({ delivered: true, mode: 'resend_live', id: (data as { id?: string }).id });
  } catch (err) {
    console.error('Transactional email error:', err);
    return res.status(500).json({ error: 'Email dispatch failed.' });
  }
});

// --- Print Spec Validation (85.6mm x 54mm, 3mm Bleed, 300 DPI) ---
app.post('/api/print/validate-spec', (req, res) => {
  const { orientation = 'landscape', hasActualQr } = req.body as {
    orientation?: 'landscape' | 'vertical';
    hasActualQr?: boolean;
  };
  const trim = orientation === 'vertical' ? { w: 54, h: 85.6 } : { w: 85.6, h: 54 };
  const bleedMm = 3;
  const fullMm = { w: +(trim.w + bleedMm * 2).toFixed(2), h: +(trim.h + bleedMm * 2).toFixed(2) };
  const dpi = 300;
  const px = {
    w: Math.round((fullMm.w / 25.4) * dpi),
    h: Math.round((fullMm.h / 25.4) * dpi),
  };
  return res.json({
    valid: Boolean(hasActualQr),
    trimMm: trim,
    bleedMm,
    fullBleedMm: fullMm,
    dpi,
    pixelDimensions300Dpi: px,
    safeMarginMm: 4,
    message: hasActualQr
      ? 'Print specification verified with embedded QR code.'
      : 'Rejected: Print-ready PDF requires a verified post-payment QR code.',
  });
});

// --- Protected SuperAdmin Bootstrap Validation ---
app.post('/api/auth/bootstrap-superadmin', (req, res) => {
  if (process.env.SUPERADMIN_BOOTSTRAP_ENABLED !== 'true') {
    return res.status(403).json({
      error: 'One-time SuperAdmin bootstrap is disabled. Set SUPERADMIN_BOOTSTRAP_ENABLED=true in server environment variables to run initial setup.',
    });
  }
  const { username, password } = req.body as { username?: string; password?: string };
  const expectedUser = process.env.SUPERADMIN_INITIAL_USERNAME;
  const expectedPass = process.env.SUPERADMIN_INITIAL_PASSWORD;
  const targetEmail = process.env.SUPERADMIN_INITIAL_EMAIL;

  if (!expectedUser || !expectedPass || !targetEmail) {
    return res.status(500).json({ error: 'Bootstrap credentials not configured in environment.' });
  }
  if (username !== expectedUser || password !== expectedPass) {
    return res.status(401).json({ error: 'Invalid bootstrap credentials.' });
  }
  return res.json({
    authorized: true,
    email: targetEmail,
    mustChangePassword: true,
    notice: 'Disable SUPERADMIN_BOOTSTRAP_ENABLED after first login and password rotation.',
  });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TapNex server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
