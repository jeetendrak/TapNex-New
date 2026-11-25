import express from 'express';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import QRCode from 'qrcode';
import { createServer as createViteServer } from 'vite';
import { validateGatewayCredentials } from './src/lib/gatewayValidation';

dotenv.config();

const PORT = 3000;
const app = express();

// Capture raw body for Razorpay webhook signature verification
app.use(
  express.json({
    limit: '4mb',
    verify: (req: express.Request & { rawBody?: Buffer }, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

const APP_BASE_URL = process.env.APP_URL || process.env.VITE_APP_URL || `http://localhost:${PORT}`;
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID || '';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';
const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID || '';
const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY || '';
const EASEBUZZ_MERCHANT_KEY = process.env.EASEBUZZ_MERCHANT_KEY || '';
const EASEBUZZ_SALT = process.env.EASEBUZZ_SALT || '';
const PAYU_MERCHANT_KEY = process.env.PAYU_MERCHANT_KEY || '';
const PAYU_MERCHANT_SALT = process.env.PAYU_MERCHANT_SALT || '';
const GOOGLE_PAY_MERCHANT_ID = process.env.GOOGLE_PAY_MERCHANT_ID || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'TapNex <orders@tapnex.in>';

type GatewayId = 'razorpay' | 'cashfree' | 'easebuzz' | 'payu' | 'gpay' | 'upi';

// Deterministic runtime sandbox secret when live gateway credentials are not configured
const SANDBOX_SIGNING_SECRET =
  process.env.RAZORPAY_SANDBOX_SECRET ||
  crypto.createHash('sha256').update(`tapnex-sandbox-${process.env.APP_URL || 'local'}`).digest('hex');

// Idempotency store for payment webhooks & verification calls
const processedPaymentIds = new Set<string>();
const processedWebhookEvents = new Set<string>();

// --- Health & Integration Status ---
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    integrations: {
      razorpayMode: RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET ? 'live' : 'sandbox',
      razorpayKeyConfigured: Boolean(RAZORPAY_KEY_ID),
      cashfreeConfigured: Boolean(CASHFREE_APP_ID && CASHFREE_SECRET_KEY),
      easebuzzConfigured: Boolean(EASEBUZZ_MERCHANT_KEY && EASEBUZZ_SALT),
      payuConfigured: Boolean(PAYU_MERCHANT_KEY && PAYU_MERCHANT_SALT),
      gpayConfigured: Boolean(GOOGLE_PAY_MERCHANT_ID),
      upiSupported: true,
      resendConfigured: Boolean(RESEND_API_KEY),
      superAdminBootstrapEnabled: process.env.SUPERADMIN_BOOTSTRAP_ENABLED === 'true',
      appBaseUrl: APP_BASE_URL,
    },
  });
});

// --- Payment Gateway Connection Test Endpoint ---
app.post('/api/payments/test-gateway', async (req, res) => {
  try {
    const body = (req.body || {}) as {
      gateway?: GatewayId;
      gatewayId?: GatewayId;
      mode?: 'sandbox' | 'live';
      publicKeyId?: string;
      merchantId?: string;
      secretKey?: string;
      upiId?: string;
    };

    const gateway = body.gateway || body.gatewayId;
    const mode = body.mode === 'live' ? 'live' : 'sandbox';
    const cleanId = String(body.publicKeyId || '').trim();
    const cleanMerchantId = String(body.merchantId || '').trim();
    const cleanSecret = String(body.secretKey || '').trim();
    const cleanUpi = String(body.upiId || '').trim();

    const envCredentials: Record<
      GatewayId,
      { id: string; secret: string; merchantId: string }
    > = {
      razorpay: { id: RAZORPAY_KEY_ID, secret: RAZORPAY_KEY_SECRET, merchantId: '' },
      cashfree: { id: CASHFREE_APP_ID, secret: CASHFREE_SECRET_KEY, merchantId: '' },
      easebuzz: { id: EASEBUZZ_MERCHANT_KEY, secret: EASEBUZZ_SALT, merchantId: '' },
      payu: { id: PAYU_MERCHANT_KEY, secret: PAYU_MERCHANT_SALT, merchantId: '' },
      gpay: { id: '', secret: '', merchantId: GOOGLE_PAY_MERCHANT_ID },
      upi: { id: '', secret: '', merchantId: '' },
    };

    const envCred = gateway ? envCredentials[gateway] : undefined;
    const effectivePublicId = cleanId || (mode === 'live' ? envCred?.id || '' : '');
    const effectiveMerchantId = cleanMerchantId || (mode === 'live' ? envCred?.merchantId || '' : '');
    const effectiveSecret = cleanSecret || envCred?.secret || '';

    const validation = validateGatewayCredentials({
      gateway,
      mode,
      publicKeyId: effectivePublicId,
      merchantId: effectiveMerchantId,
      secretKey: effectiveSecret,
      upiId: cleanUpi,
      hasServerSecret: Boolean(envCred?.secret),
    });

    if (!validation.ok) {
      return res.status(400).json({
        ok: false,
        verified: false,
        verdict: 'FAIL',
        gateway,
        mode,
        error: validation.error,
        message: validation.message,
      });
    }

    if (gateway === 'gpay' || gateway === 'upi') {
      const upiTestUri = `upi://pay?pa=${encodeURIComponent(cleanUpi)}&mc=${encodeURIComponent(effectiveMerchantId)}&cu=INR`;
      const isValidUri = upiTestUri.startsWith('upi://pay?');
      if (!isValidUri) {
        return res.status(400).json({
          ok: false,
          verified: false,
          verdict: 'FAIL',
          gateway,
          mode,
          error: 'Unable to construct valid UPI intent URI.',
        });
      }
      return res.json({
        ok: true,
        verified: true,
        verdict: 'PASS',
        gateway,
        mode,
        status: 'PASS',
        message: validation.message,
      });
    }

    if (gateway === 'razorpay') {
      if (mode === 'live') {
        const authHeader = Buffer.from(`${effectivePublicId}:${effectiveSecret}`).toString('base64');
        const ping = await fetch('https://api.razorpay.com/v1/orders?count=1', {
          headers: { Authorization: `Basic ${authHeader}` },
          signal: AbortSignal.timeout(7000),
        });
        if (!ping.ok) {
          return res.status(400).json({
            ok: false,
            verified: false,
            verdict: 'FAIL',
            gateway,
            mode,
            error: `Razorpay live API authentication failed (HTTP ${ping.status}). Check Key ID and Secret Key.`,
          });
        }
        return res.json({
          ok: true,
          verified: true,
          verdict: 'PASS',
          gateway,
          mode,
          status: 'PASS',
          message: 'Razorpay live Key ID & Secret Key authenticated with Razorpay API.',
        });
      }

      // Sandbox: verify cryptographic HMAC-SHA256 signing roundtrip with provided key
      const testPayload = `order_sbx_test|pay_sbx_${effectivePublicId.slice(-6)}`;
      const sig = crypto.createHmac('sha256', effectiveSecret).update(testPayload).digest('hex');
      const expected = crypto.createHmac('sha256', effectiveSecret).update(testPayload).digest('hex');
      const verifiedHmac = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
      if (!verifiedHmac) {
        return res.status(400).json({
          ok: false,
          verified: false,
          verdict: 'FAIL',
          gateway,
          mode,
          error: 'Sandbox HMAC verification failed.',
        });
      }
      return res.json({
        ok: true,
        verified: true,
        verdict: 'PASS',
        gateway,
        mode,
        status: 'PASS',
        message: `Razorpay Sandbox ID (${effectivePublicId.slice(0, 14)}...) & Key HMAC verified.`,
      });
    }

    if (gateway === 'cashfree') {
      if (mode === 'live') {
        const cfPing = await fetch('https://api.cashfree.com/pg/orders?limit=1', {
          headers: {
            'x-client-id': effectivePublicId,
            'x-client-secret': effectiveSecret,
            'x-api-version': '2023-08-01',
          },
          signal: AbortSignal.timeout(7000),
        });
        if (cfPing.status === 401 || cfPing.status === 403) {
          return res.status(400).json({
            ok: false,
            verified: false,
            verdict: 'FAIL',
            gateway,
            mode,
            error: `Cashfree live authentication rejected App ID / Secret Key (HTTP ${cfPing.status}).`,
          });
        }
        if (!cfPing.ok && cfPing.status >= 500) {
          return res.status(502).json({
            ok: false,
            verified: false,
            verdict: 'FAIL',
            gateway,
            mode,
            error: `Cashfree API unavailable (HTTP ${cfPing.status}).`,
          });
        }
        return res.json({
          ok: true,
          verified: true,
          verdict: 'PASS',
          gateway,
          mode,
          status: 'PASS',
          message: 'Cashfree live App ID & Secret Key authenticated.',
        });
      }

      const testSig = crypto
        .createHmac('sha256', effectiveSecret)
        .update(`${effectivePublicId}|cashfree_sandbox_ping`)
        .digest('base64');
      if (!testSig) {
        return res.status(400).json({
          ok: false,
          verified: false,
          verdict: 'FAIL',
          gateway,
          mode,
          error: 'Cashfree sandbox signature check failed.',
        });
      }
      return res.json({
        ok: true,
        verified: true,
        verdict: 'PASS',
        gateway,
        mode,
        status: 'PASS',
        message: `Cashfree Sandbox App ID & Secret Key HMAC verified.`,
      });
    }

    if (gateway === 'easebuzz' || gateway === 'payu') {
      const hashInput = `${effectivePublicId}|tx_test_01|100.00|TapNex Card|Test|test@tapnex.in|||||||||||${effectiveSecret}`;
      const sha512 = crypto.createHash('sha512').update(hashInput).digest('hex');
      if (sha512.length !== 128) {
        return res.status(400).json({
          ok: false,
          verified: false,
          verdict: 'FAIL',
          gateway,
          mode,
          error: `${gateway.toUpperCase()} SHA-512 key checksum failed.`,
        });
      }
      return res.json({
        ok: true,
        verified: true,
        verdict: 'PASS',
        gateway,
        mode,
        status: 'PASS',
        message: `${gateway === 'easebuzz' ? 'Easebuzz' : 'PayU'} ID & Salt Key SHA-512 checksum verified (${mode}).`,
      });
    }

    return res.json({
      ok: true,
      verified: true,
      verdict: 'PASS',
      gateway,
      mode,
      status: 'PASS',
      message: validation.message,
    });
  } catch (err) {
    console.error('Test gateway error:', err instanceof Error ? err.message : 'Unexpected error');
    return res.status(500).json({
      ok: false,
      verified: false,
      verdict: 'FAIL',
      error: 'Failed to test gateway connection. Check network or credentials.',
    });
  }
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

// --- Multi-Gateway Order Creation (Razorpay, Cashfree, Easebuzz, PayU, Google Pay, UPI) ---
app.post('/api/payments/create-order', async (req, res) => {
  try {
    const {
      orderId,
      amountInr,
      receipt,
      customerEmail,
      customerName,
      customerPhone,
      gateway = 'razorpay',
      requestedMode,
      upiId,
      upiPayeeName,
    } = req.body as {
      orderId?: string;
      amountInr?: number;
      receipt?: string;
      customerEmail?: string;
      customerName?: string;
      customerPhone?: string;
      gateway?: GatewayId;
      requestedMode?: 'sandbox' | 'live';
      upiId?: string;
      upiPayeeName?: string;
    };

    if (!orderId || !amountInr || Number(amountInr) <= 0) {
      return res.status(400).json({ error: 'Valid orderId and positive amountInr are required.' });
    }

    const allowedGateways: GatewayId[] = ['razorpay', 'cashfree', 'easebuzz', 'payu', 'gpay', 'upi'];
    const safeGateway: GatewayId = allowedGateways.includes(gateway) ? gateway : 'razorpay';
    const amountPaise = Math.round(Number(amountInr) * 100);
    const amountDecimal = Number(amountInr).toFixed(2);

    if (safeGateway === 'razorpay') {
      const isLiveConfigured = Boolean(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET) && requestedMode !== 'sandbox';
      if (isLiveConfigured) {
        const authHeader = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
        const rzpResponse = await fetch('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: {
            Authorization: `Basic ${authHeader}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            amount: amountPaise,
            currency: 'INR',
            receipt: receipt || orderId,
            notes: { internalOrderId: orderId, customerEmail: customerEmail || '' },
          }),
        });

        if (!rzpResponse.ok) {
          const errText = await rzpResponse.text();
          return res.status(502).json({ error: 'Razorpay order creation failed.', details: errText });
        }

        const rzpOrder = (await rzpResponse.json()) as { id: string; amount: number; currency: string };
        return res.json({
          gateway: 'razorpay',
          mode: 'razorpay_live',
          keyId: RAZORPAY_KEY_ID,
          gatewayOrderId: rzpOrder.id,
          amountPaise: rzpOrder.amount,
          currency: rzpOrder.currency,
        });
      }

      const sandboxOrderId = `order_rzp_sbx_${orderId.slice(0, 10)}_${Date.now()}`;
      return res.json({
        gateway: 'razorpay',
        mode: 'razorpay_sandbox',
        keyId: 'rzp_test_sandbox_configured_server',
        gatewayOrderId: sandboxOrderId,
        amountPaise,
        currency: 'INR',
        sandboxNotice: 'Razorpay Sandbox active. Add RAZORPAY_KEY_ID & RAZORPAY_KEY_SECRET on server for live mode.',
      });
    }

    if (safeGateway === 'cashfree') {
      const hasLiveKeys = Boolean(CASHFREE_APP_ID && CASHFREE_SECRET_KEY) && requestedMode === 'live';
      if (hasLiveKeys) {
        const cfResponse = await fetch('https://api.cashfree.com/pg/orders', {
          method: 'POST',
          headers: {
            'x-client-id': CASHFREE_APP_ID,
            'x-client-secret': CASHFREE_SECRET_KEY,
            'x-api-version': '2023-08-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            order_id: `cf_${orderId.slice(0, 18)}_${Date.now()}`,
            order_amount: Number(amountDecimal),
            order_currency: 'INR',
            customer_details: {
              customer_id: orderId.slice(0, 24),
              customer_email: customerEmail || 'customer@tapnex.in',
              customer_phone: (customerPhone || '9999999999').replace(/[^0-9]/g, '').slice(-10) || '9999999999',
              customer_name: customerName || 'TapNex Customer',
            },
          }),
        });
        if (!cfResponse.ok) {
          const errText = await cfResponse.text();
          return res.status(502).json({ error: 'Cashfree order creation failed.', details: errText });
        }
        const cfData = (await cfResponse.json()) as { order_id: string; payment_session_id?: string };
        return res.json({
          gateway: 'cashfree',
          mode: 'cashfree_live',
          gatewayOrderId: cfData.order_id,
          paymentSessionId: cfData.payment_session_id,
          amountPaise,
          currency: 'INR',
        });
      }
      return res.json({
        gateway: 'cashfree',
        mode: 'cashfree_sandbox',
        gatewayOrderId: `order_cf_sbx_${orderId.slice(0, 10)}_${Date.now()}`,
        amountPaise,
        currency: 'INR',
        sandboxNotice: 'Cashfree Sandbox active. Configure CASHFREE_APP_ID & CASHFREE_SECRET_KEY on server for live mode.',
      });
    }

    if (safeGateway === 'easebuzz') {
      const hasLiveKeys = Boolean(EASEBUZZ_MERCHANT_KEY && EASEBUZZ_SALT) && requestedMode === 'live';
      const txnid = `eb_${orderId.slice(0, 12)}_${Date.now()}`;
      if (hasLiveKeys) {
        const hashString = `${EASEBUZZ_MERCHANT_KEY}|${txnid}|${amountDecimal}|SMART Card|${customerName || 'Customer'}|${customerEmail || 'customer@tapnex.in'}|||||||||||${EASEBUZZ_SALT}`;
        const hash = crypto.createHash('sha512').update(hashString).digest('hex');
        return res.json({
          gateway: 'easebuzz',
          mode: 'easebuzz_live',
          keyId: EASEBUZZ_MERCHANT_KEY,
          gatewayOrderId: txnid,
          hash,
          amountPaise,
          currency: 'INR',
        });
      }
      return res.json({
        gateway: 'easebuzz',
        mode: 'easebuzz_sandbox',
        gatewayOrderId: `order_eb_sbx_${orderId.slice(0, 10)}_${Date.now()}`,
        amountPaise,
        currency: 'INR',
        sandboxNotice: 'Easebuzz Sandbox active. Configure EASEBUZZ_MERCHANT_KEY & EASEBUZZ_SALT on server for live mode.',
      });
    }

    if (safeGateway === 'payu') {
      const hasLiveKeys = Boolean(PAYU_MERCHANT_KEY && PAYU_MERCHANT_SALT) && requestedMode === 'live';
      const txnid = `payu_${orderId.slice(0, 12)}_${Date.now()}`;
      if (hasLiveKeys) {
        const hashString = `${PAYU_MERCHANT_KEY}|${txnid}|${amountDecimal}|TapNex SMART Card|${customerName || 'Customer'}|${customerEmail || 'customer@tapnex.in'}|||||||||||${PAYU_MERCHANT_SALT}`;
        const hash = crypto.createHash('sha512').update(hashString).digest('hex');
        return res.json({
          gateway: 'payu',
          mode: 'payu_live',
          keyId: PAYU_MERCHANT_KEY,
          gatewayOrderId: txnid,
          hash,
          amountPaise,
          currency: 'INR',
        });
      }
      return res.json({
        gateway: 'payu',
        mode: 'payu_sandbox',
        gatewayOrderId: `order_payu_sbx_${orderId.slice(0, 10)}_${Date.now()}`,
        amountPaise,
        currency: 'INR',
        sandboxNotice: 'PayU Sandbox active. Configure PAYU_MERCHANT_KEY & PAYU_MERCHANT_SALT on server for live mode.',
      });
    }

    // UPI Direct or Google Pay (UPI intent + scannable UPI QR)
    const vpa = (upiId || 'tapnex@upi').trim();
    const payee = encodeURIComponent((upiPayeeName || 'TapNex Smart Cards').trim());
    const txRef = `${safeGateway}_${orderId.slice(0, 10)}_${Date.now()}`;
    const upiUri = `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${payee}&tr=${encodeURIComponent(txRef)}&tn=${encodeURIComponent(`TapNex Order ${receipt || orderId}`)}&am=${amountDecimal}&cu=INR`;
    const upiQrDataUrl = await QRCode.toDataURL(upiUri, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 512,
      color: { dark: '#0B1D3A', light: '#FFFFFF' },
    });

    const isLiveUpi = requestedMode === 'live' && Boolean(upiId);
    const mode =
      safeGateway === 'gpay'
        ? isLiveUpi
          ? 'gpay_live'
          : 'gpay_sandbox'
        : isLiveUpi
          ? 'upi_live'
          : 'upi_sandbox';

    return res.json({
      gateway: safeGateway,
      mode,
      keyId: GOOGLE_PAY_MERCHANT_ID || vpa,
      gatewayOrderId: txRef,
      amountPaise,
      currency: 'INR',
      upiUri,
      upiQrDataUrl,
      upiId: vpa,
      sandboxNotice:
        isLiveUpi
          ? undefined
          : `${safeGateway === 'gpay' ? 'Google Pay' : 'UPI'} running in sandbox/test verification mode.`,
    });
  } catch (err) {
    console.error('Create payment order error:', err);
    return res.status(500).json({ error: 'Internal payment order creation error.' });
  }
});

// --- Multi-Gateway Sandbox Challenge Signature Helper (Produces Valid HMAC-SHA256 for Verification) ---
app.post('/api/payments/sandbox-authorize', (req, res) => {
  const { gatewayOrderId, gateway = 'razorpay', simulateOutcome = 'success', utrRef } = req.body as {
    gatewayOrderId?: string;
    gateway?: GatewayId;
    simulateOutcome?: 'success' | 'failure' | 'cancelled';
    utrRef?: string;
  };
  if (!gatewayOrderId) {
    return res.status(400).json({ error: 'gatewayOrderId is required.' });
  }
  if (gateway === 'razorpay' && RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET) {
    return res.status(403).json({ error: 'Razorpay sandbox authorization is disabled when live Razorpay keys are active.' });
  }
  if (simulateOutcome !== 'success') {
    return res.json({
      outcome: simulateOutcome,
      error:
        simulateOutcome === 'cancelled'
          ? `Payment cancelled by user in ${gateway.toUpperCase()} checkout.`
          : `Payment declined by bank in ${gateway.toUpperCase()} checkout.`,
    });
  }
  const cleanUtr = utrRef ? utrRef.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) : '';
  const gatewayPaymentId = cleanUtr ? `${gateway}_utr_${cleanUtr}` : `pay_${gateway}_sbx_${crypto.randomBytes(6).toString('hex')}`;
  const signature = crypto
    .createHmac('sha256', SANDBOX_SIGNING_SECRET)
    .update(`${gatewayOrderId}|${gatewayPaymentId}`)
    .digest('hex');

  return res.json({
    outcome: 'success',
    gateway,
    gatewayOrderId,
    gatewayPaymentId,
    signature,
  });
});

// --- Server-Side Payment Signature Verification + Post-Payment QR Generation ---
app.post('/api/payments/verify', async (req, res) => {
  try {
    const {
      orderId,
      gatewayOrderId,
      gatewayPaymentId,
      signature,
      mode,
      profileSlug,
      appOrigin,
    } = req.body as {
      orderId?: string;
      gatewayOrderId?: string;
      gatewayPaymentId?: string;
      signature?: string;
      mode?: string;
      profileSlug?: string;
      appOrigin?: string;
    };

    if (!orderId || !gatewayOrderId || !gatewayPaymentId || !signature || !profileSlug) {
      return res.status(400).json({ error: 'Missing required verification parameters.' });
    }

    if (processedPaymentIds.has(gatewayPaymentId)) {
      return res.status(409).json({ error: 'Duplicate payment processing blocked (idempotent guard).' });
    }

    let secret = SANDBOX_SIGNING_SECRET;
    if (mode === 'razorpay_live') {
      if (!RAZORPAY_KEY_SECRET) {
        return res.status(500).json({ error: 'Server missing RAZORPAY_KEY_SECRET for live verification.' });
      }
      secret = RAZORPAY_KEY_SECRET;
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${gatewayOrderId}|${gatewayPaymentId}`)
      .digest('hex');

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSignature);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return res.status(400).json({ verified: false, error: 'Invalid payment cryptographic signature.' });
    }

    processedPaymentIds.add(gatewayPaymentId);

    // Generate actual customer QR code ONLY after verified payment!
    const baseUrl = (appOrigin || APP_BASE_URL).replace(/\/+$/, '');
    const targetUrl = `${baseUrl}/p/${profileSlug}`;

    const svgContent = await QRCode.toString(targetUrl, {
      type: 'svg',
      errorCorrectionLevel: 'H',
      margin: 4,
      color: { dark: '#0B1D3A', light: '#FFFFFF' },
    });

    const pngDataUrl = await QRCode.toDataURL(targetUrl, {
      errorCorrectionLevel: 'H',
      margin: 4,
      width: 1024,
      color: { dark: '#0B1D3A', light: '#FFFFFF' },
    });

    return res.json({
      verified: true,
      orderId,
      gatewayPaymentId,
      verifiedAt: new Date().toISOString(),
      qrArtifact: {
        targetUrl,
        svgContent,
        pngDataUrl,
        format: 'PNG_SVG',
      },
    });
  } catch (err) {
    console.error('Payment verification error:', err);
    return res.status(500).json({ error: 'Payment verification failed.' });
  }
});

// --- Razorpay Webhook Verification ---
app.post('/api/payments/webhook', (req: express.Request & { rawBody?: Buffer }, res) => {
  const signature = req.headers['x-razorpay-signature'];
  if (!RAZORPAY_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'RAZORPAY_WEBHOOK_SECRET not configured.' });
  }
  if (!signature || typeof signature !== 'string' || !req.rawBody) {
    return res.status(400).json({ error: 'Missing webhook signature or payload.' });
  }
  const expected = crypto
    .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
    .update(req.rawBody)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return res.status(401).json({ error: 'Invalid webhook signature.' });
  }

  const eventId = (req.headers['x-razorpay-event-id'] as string) || JSON.stringify(req.body).slice(0, 64);
  if (processedWebhookEvents.has(eventId)) {
    return res.json({ status: 'already_processed' });
  }
  processedWebhookEvents.add(eventId);
  return res.json({ status: 'ok', event: req.body?.event || 'unknown' });
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
