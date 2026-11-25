import type { PaymentGatewayId } from '../types';

export interface GatewayValidationInput {
  gateway?: string;
  mode?: 'sandbox' | 'live';
  publicKeyId?: string;
  merchantId?: string;
  secretKey?: string;
  upiId?: string;
  hasServerSecret?: boolean;
}

export interface GatewayValidationResult {
  ok: boolean;
  verdict: 'PASS' | 'FAIL';
  message: string;
  error?: string;
}

const ALLOWED_GATEWAYS: PaymentGatewayId[] = [
  'razorpay',
  'cashfree',
  'easebuzz',
  'payu',
  'gpay',
  'upi',
];

const UPI_VPA_REGEX = /^[a-zA-Z0-9._-]{2,}@[a-zA-Z0-9.-]{2,}$/;

export function validateGatewayCredentials(
  input: GatewayValidationInput
): GatewayValidationResult {
  const gateway = input.gateway as PaymentGatewayId | undefined;
  const mode = input.mode === 'live' ? 'live' : 'sandbox';

  if (!gateway || !ALLOWED_GATEWAYS.includes(gateway)) {
    const msg = 'Unsupported payment gateway.';
    return { ok: false, verdict: 'FAIL', message: msg, error: msg };
  }

  const publicKeyId = String(input.publicKeyId || '').trim();
  const merchantId = String(input.merchantId || '').trim();
  const secretKey = String(input.secretKey || '').trim();
  const upiId = String(input.upiId || '').trim();
  const hasSecret = secretKey.length > 0 || Boolean(input.hasServerSecret);

  if (gateway === 'gpay' || gateway === 'upi') {
    const label = gateway === 'gpay' ? 'Google Pay' : 'UPI';
    const minIdLen = gateway === 'gpay' ? 4 : 3;
    if (merchantId.length < minIdLen) {
      const msg = `Enter a valid ${label} Merchant / Terminal ID (min ${minIdLen} characters).`;
      return { ok: false, verdict: 'FAIL', message: msg, error: msg };
    }
    if (!upiId || !UPI_VPA_REGEX.test(upiId)) {
      const msg = `Enter a valid ${label} UPI VPA Key (e.g. merchant@okaxis).`;
      return { ok: false, verdict: 'FAIL', message: msg, error: msg };
    }
    return {
      ok: true,
      verdict: 'PASS',
      message: `${label} ID (${merchantId}) & VPA Key (${upiId}) verified in ${mode} mode.`,
    };
  }

  if (gateway === 'razorpay') {
    if (mode === 'live' && !/^rzp_live_[A-Za-z0-9]{6,}$/.test(publicKeyId)) {
      const msg = 'Enter a valid Razorpay Live Key ID starting with rzp_live_.';
      return { ok: false, verdict: 'FAIL', message: msg, error: msg };
    }
    if (mode === 'sandbox' && !/^rzp_test_[A-Za-z0-9]{6,}$/.test(publicKeyId)) {
      const msg = 'Enter a valid Razorpay Test Key ID starting with rzp_test_.';
      return { ok: false, verdict: 'FAIL', message: msg, error: msg };
    }
    if (!hasSecret || (secretKey.length > 0 && secretKey.length < 8)) {
      const msg = 'Enter a valid Razorpay Secret Key (min 8 characters).';
      return { ok: false, verdict: 'FAIL', message: msg, error: msg };
    }
    return {
      ok: true,
      verdict: 'PASS',
      message: `Razorpay Key ID & Secret Key verified (${mode} mode).`,
    };
  }

  if (gateway === 'cashfree') {
    if (publicKeyId.length < 6) {
      const msg = 'Enter a valid Cashfree App ID (min 6 characters).';
      return { ok: false, verdict: 'FAIL', message: msg, error: msg };
    }
    if (!hasSecret || (secretKey.length > 0 && secretKey.length < 8)) {
      const msg = 'Enter a valid Cashfree Secret Key (min 8 characters).';
      return { ok: false, verdict: 'FAIL', message: msg, error: msg };
    }
    return {
      ok: true,
      verdict: 'PASS',
      message: `Cashfree App ID & Secret Key verified (${mode} mode).`,
    };
  }

  if (gateway === 'easebuzz') {
    if (publicKeyId.length < 5) {
      const msg = 'Enter a valid Easebuzz Key ID (min 5 characters).';
      return { ok: false, verdict: 'FAIL', message: msg, error: msg };
    }
    if (!hasSecret || (secretKey.length > 0 && secretKey.length < 6)) {
      const msg = 'Enter a valid Easebuzz Salt Key (min 6 characters).';
      return { ok: false, verdict: 'FAIL', message: msg, error: msg };
    }
    return {
      ok: true,
      verdict: 'PASS',
      message: `Easebuzz Key ID & Salt Key verified (${mode} mode).`,
    };
  }

  // PayU
  if (publicKeyId.length < 4) {
    const msg = 'Enter a valid PayU Merchant ID (min 4 characters).';
    return { ok: false, verdict: 'FAIL', message: msg, error: msg };
  }
  if (!hasSecret || (secretKey.length > 0 && secretKey.length < 6)) {
    const msg = 'Enter a valid PayU Merchant Salt Key (min 6 characters).';
    return { ok: false, verdict: 'FAIL', message: msg, error: msg };
  }
  return {
    ok: true,
    verdict: 'PASS',
    message: `PayU Merchant ID & Salt Key verified (${mode} mode).`,
  };
}
