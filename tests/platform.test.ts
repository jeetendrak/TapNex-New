import { describe, expect, it } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  BLANK_CARD_TEMPLATE,
  createBlankSideDesign,
  DEFAULT_CARD_TEMPLATES,
  DEFAULT_SHOP_CATEGORIES,
  DEFAULT_SHOP_PRODUCTS,
  DEFAULT_VISIBILITY,
  PAYMENT_GATEWAY_ORDER,
} from '../src/lib/constants';
import {
  buildSanitizedPublicProfile,
  calculateProfileCompletion,
  copyProfileFieldsBySelection,
  filterAuditLogs,
  generateAutoProfileSlug,
  isOrderPaymentConfirmed,
  maskEmail,
  maskPhone,
  mergePaymentGateways,
  RESETTABLE_OPERATIONAL_COLLECTIONS,
  resetApplicationToFreshBlank,
  sanitizeSlug,
  sortCardTemplates,
} from '../src/lib/firestoreService';
import { resolveEffectiveCardDesign } from '../src/lib/studioDraft';
import { buildPublicVCard } from '../src/lib/vcard';
import {
  CARD_BLEED_MM,
  CARD_TRIM_LANDSCAPE_MM,
  mmToPx300Dpi,
  resolveCardTokens,
} from '../src/lib/printPdf';
import { generateHighResQrArtwork, generatePrinterAuthId } from '../src/lib/qrArtwork';
import { ROLE_CAPABILITY_MATRIX, ROLE_GUIDES } from '../src/data/guideContent';
import {
  alignTargetsOnSide,
  applyElementSnapshot,
  areElementSnapshotsEqual,
  computeSnapAndGuidelines,
  extractElementSnapshot,
  nudgeTargetsOnSide,
  resetSingleElementOnSide,
  resolveSideMediaClipCircle,
  wrapCanvasTextLines,
} from '../src/lib/cardLayout';
import {
  buildEffectiveProfileInfo,
  doesSideContainField,
  getNextCleanCardTextSlot,
  populateSideWithProfileInfo,
  refreshUneditedSideWithProfileInfo,
  selectDefaultTemplateForProfile,
} from '../src/lib/cardProfileSync';
import { resolveCardPricing } from '../src/lib/pricing';
import { validateGatewayCredentials } from '../src/lib/gatewayValidation';
import {
  normalizeHexColor,
  sanitizeRichBioHtml,
  stripHtmlToPlainText,
} from '../src/lib/richText';
import type { AuditLogRecord, CardDesignRecord, ProfileRecord } from '../src/types';

function makeSampleProfile(overrides: Partial<ProfileRecord> = {}): ProfileRecord {
  return {
    profileId: 'prof_test_1',
    uid: 'user_test_1',
    slug: 'aarav-mehta',
    profileLabel: 'Primary Profile',
    selectedTemplate: 'tpl_navy_obsidian',
    isPublic: true,
    personalInformation: {
      photoDataUrl: 'data:image/png;base64,iVBOR',
      fullName: 'Aarav Mehta',
      jobTitle: 'Managing Director',
      companyName: 'Meridian Advisory',
      businessCategory: 'Consulting',
      shortBio: 'Strategic advisor for growth companies.',
      mobile: '+91 98201 44510',
      alternateMobile: '+91 99999 00000',
      whatsapp: '+91 98201 44510',
      email: 'aarav@meridianadvisory.in',
      alternateEmail: 'private@personal.in',
      website: 'https://meridianadvisory.in',
      businessAddress: '14th Floor, Nariman Point',
      personalAddress: '12B Seaface Residences, Worli',
      city: 'Mumbai',
      state: 'Maharashtra',
      pinCode: '400021',
      country: 'India',
    },
    socialLinks: [
      {
        id: 'linkedin',
        platform: 'linkedin',
        label: 'LinkedIn',
        url: 'https://linkedin.com/in/aarav',
        enabled: true,
        order: 0,
      },
      {
        id: 'github',
        platform: 'github',
        label: 'GitHub',
        url: 'https://github.com/aarav-private',
        enabled: false,
        order: 1,
      },
    ],
    customFields: [
      {
        id: 'cf_1',
        label: 'Book Consultation',
        value: 'https://cal.com/aarav',
        type: 'url',
        visible: true,
        order: 0,
      },
      {
        id: 'cf_2',
        label: 'Internal PAN Ref',
        value: 'ABCDE1234F',
        type: 'text',
        visible: false,
        order: 1,
      },
    ],
    visibilitySettings: {
      ...DEFAULT_VISIBILITY,
      alternateMobile: false,
      alternateEmail: false,
      businessAddress: false,
    },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('Public Profile Privacy & Field Visibility Isolation', () => {
  it('excludes all hidden fields, disabled social links, and private custom fields', () => {
    const profile = makeSampleProfile();
    const pub = buildSanitizedPublicProfile(profile);

    expect(pub.isPublic).toBe(true);
    expect(pub.personalInformation?.fullName).toBe('Aarav Mehta');
    expect(pub.personalInformation?.mobile).toBe('+91 98201 44510');

    // Hidden fields MUST be strictly omitted (not even empty strings)
    expect(pub.personalInformation?.alternateMobile).toBeUndefined();
    expect(pub.personalInformation?.alternateEmail).toBeUndefined();
    expect(pub.personalInformation?.businessAddress).toBeUndefined();
    expect(pub.personalInformation?.personalAddress).toBeUndefined();
    expect(pub.personalInformation?.city).toBeUndefined();

    // Only enabled social links appear
    expect(pub.socialLinks).toHaveLength(1);
    expect(pub.socialLinks?.[0].id).toBe('linkedin');

    // Only visible custom fields appear
    expect(pub.customFields).toHaveLength(1);
    expect(pub.customFields?.[0].label).toBe('Book Consultation');
  });

  it('strips all personal info when isPublic is toggled off', () => {
    const profile = makeSampleProfile({ isPublic: false });
    const pub = buildSanitizedPublicProfile(profile, 'Profile temporarily offline.');

    expect(pub.isPublic).toBe(false);
    expect(pub.personalInformation).toBeUndefined();
    expect(pub.socialLinks).toBeUndefined();
    expect(pub.customFields).toBeUndefined();
    expect(pub.unavailableMessage).toBe('Profile temporarily offline.');
  });

  it('honors explicit visibilitySettings.socialLinks overrides over link.enabled', () => {
    const profile = makeSampleProfile({
      visibilitySettings: {
        ...DEFAULT_VISIBILITY,
        socialLinks: {
          linkedin: false,
          github: true,
        },
      },
    });
    const pub = buildSanitizedPublicProfile(profile);
    expect(pub.socialLinks?.map((l) => l.id)).toEqual(['github']);
  });
});

describe('vCard (.vcf) Generation', () => {
  it('generates RFC-compliant vCard 3.0 from strictly visible public fields', () => {
    const profile = makeSampleProfile();
    const pub = buildSanitizedPublicProfile(profile) as Parameters<typeof buildPublicVCard>[0];
    const vcf = buildPublicVCard(pub, 'https://tapnex.in/p/aarav-mehta');

    expect(vcf).toContain('BEGIN:VCARD');
    expect(vcf).toContain('VERSION:3.0');
    expect(vcf).toContain('FN:Aarav Mehta');
    expect(vcf).toContain('N:Mehta;Aarav;;;');
    expect(vcf).toContain('ORG:Meridian Advisory');
    expect(vcf).toContain('TEL;TYPE=CELL,VOICE:+91 98201 44510');
    expect(vcf).toContain('EMAIL;TYPE=PREF,INTERNET:aarav@meridianadvisory.in');
    expect(vcf).toContain('URL;TYPE=DigitalProfile:https://tapnex.in/p/aarav-mehta');
    expect(vcf).not.toContain('+91 99999 00000');
    expect(vcf).not.toContain('private@personal.in');
    expect(vcf).toContain('END:VCARD');
  });
});

describe('Slug Sanitization & Print-Ready 300 DPI Geometry', () => {
  it('sanitizes profile URL slugs safely', () => {
    expect(sanitizeSlug('  Aarav Mehta — Founder! ')).toBe('aarav-mehta-founder');
    expect(sanitizeSlug('___hello---world___')).toBe('hello-world');
  });

  it('calculates profile completion percentage accurately', () => {
    const profile = makeSampleProfile();
    expect(calculateProfileCompletion(profile)).toBe(100);
    expect(calculateProfileCompletion(null)).toBe(0);
  });

  it('computes exact ISO 7810 ID-1 85.6x54mm + 3mm bleed at 300 DPI (1082x709 px)', () => {
    const fullW = CARD_TRIM_LANDSCAPE_MM.width + CARD_BLEED_MM * 2;
    const fullH = CARD_TRIM_LANDSCAPE_MM.height + CARD_BLEED_MM * 2;
    expect(fullW).toBeCloseTo(91.6, 2);
    expect(fullH).toBeCloseTo(60.0, 2);
    expect(mmToPx300Dpi(fullW)).toBe(1082);
    expect(mmToPx300Dpi(fullH)).toBe(709);
  });

  it('resolves card template tokens cleanly including extended profile fields', () => {
    const resolved = resolveCardTokens('{{FULL_NAME}} — {{COMPANY}}', {
      fullName: 'Priya Deshmukh',
      companyName: 'Studio Vastu',
    });
    expect(resolved).toBe('Priya Deshmukh — Studio Vastu');

    const extended = resolveCardTokens(
      '{{BUSINESS_CATEGORY}} | {{WHATSAPP}} | {{ALTERNATE_MOBILE}} | {{ALTERNATE_EMAIL}} | {{CITY_STATE}} | {{ADDRESS}} | {{PERSONAL_ADDRESS}} | {{SHORT_BIO}}',
      {
        businessCategory: 'Architecture',
        whatsapp: '+91 98201 44510',
        alternateMobile: '+91 99999 11111',
        alternateEmail: 'desk@vastu.in',
        city: 'Pune',
        state: 'Maharashtra',
        businessAddress: 'FC Road, 12',
        personalAddress: 'Kothrud, Pune',
        shortBio: 'Sustainable spatial studio.',
      }
    );
    expect(extended).toBe(
      'Architecture | +91 98201 44510 | +91 99999 11111 | desk@vastu.in | Pune, Maharashtra | FC Road, 12, Pune, Maharashtra | Kothrud, Pune | Sustainable spatial studio.'
    );

    const genericFallbacks = resolveCardTokens(
      '{{FULL_NAME}} | {{MOBILE}} | {{EMAIL}} | {{WEBSITE}}',
      {}
    );
    expect(genericFallbacks).toBe('Your Name | Your Number | Your Email ID | Your Website');
  });
});

describe('Razorpay HMAC-SHA256 Verification & Firestore Security Guardrails', () => {
  it('verifies authentic HMAC-SHA256 signatures and rejects tampered payment IDs', () => {
    const secret = 'test_rzp_secret_key';
    const orderId = 'order_123456';
    const paymentId = 'pay_789012';
    const sig = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');

    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    expect(crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))).toBe(true);

    const tamperedExpected = crypto
      .createHmac('sha256', secret)
      .update(`${orderId}|pay_tampered`)
      .digest('hex');
    expect(crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(tamperedExpected))).toBe(false);
  });

  it('verifies deployed firestore.rules enforces email verification and anti-tamper payment checks', () => {
    const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
    expect(rules).toContain('request.auth.token.email_verified == true');
    expect(rules).toContain("incoming().paymentStatus == 'Pending'");
    expect(rules).toContain("incoming().orderStatus == 'Awaiting Payment'");
    expect(rules).toContain('existsAfter(/databases/$(database)/documents/payments/$(orderId))');
    expect(rules).toContain('allow get: if isValidId(slug);');
    expect(rules).toContain('paymentConfirmed');
  });

  it('masks sensitive contact values and detects payment confirmation states properly', () => {
    expect(maskPhone('+91 98201 44510')).toContain('***');
    expect(maskPhone('+91 98201 44510')).not.toBe('+91 98201 44510');
    expect(maskEmail('aarav@meridianadvisory.in')).toBe('aa***@me***.in');

    expect(
      isOrderPaymentConfirmed(
        [
          {
            orderId: 'ord_1',
            orderNumber: 'TNX-1',
            uid: 'u1',
            profileId: 'prof_1',
            designId: 'des_1',
            quantity: 1,
            total: 999,
            currency: 'INR',
            paymentStatus: 'Pending',
            orderStatus: 'Awaiting Payment',
            shippingAddress: {
              fullName: 'Aarav',
              mobile: '9820144510',
              email: 'a@b.in',
              addressLine1: '1',
              city: 'Mumbai',
              state: 'Maharashtra',
              pinCode: '400001',
              country: 'India',
            },
            createdAt: '',
            updatedAt: '',
          },
        ],
        'prof_1'
      )
    ).toBe(false);

    expect(
      isOrderPaymentConfirmed(
        [
          {
            orderId: 'ord_2',
            orderNumber: 'TNX-2',
            uid: 'u1',
            profileId: 'prof_1',
            designId: 'des_1',
            quantity: 1,
            total: 999,
            currency: 'INR',
            paymentStatus: 'Completed',
            orderStatus: 'Payment Successful',
            shippingAddress: {
              fullName: 'Aarav',
              mobile: '9820144510',
              email: 'a@b.in',
              addressLine1: '1',
              city: 'Mumbai',
              state: 'Maharashtra',
              pinCode: '400001',
              country: 'India',
            },
            createdAt: '',
            updatedAt: '',
          },
        ],
        'prof_1'
      )
    ).toBe(true);

    expect(
      isOrderPaymentConfirmed(
        [
          {
            orderId: 'ord_3',
            orderNumber: 'TNX-3',
            uid: 'u1',
            profileId: 'legacy_prof',
            profileSlug: 'aarav-mehta',
            designId: 'des_1',
            quantity: 1,
            total: 999,
            currency: 'INR',
            paymentStatus: 'Verified',
            orderStatus: 'Payment Successful',
            shippingAddress: {
              fullName: 'Aarav',
              mobile: '9820144510',
              email: 'a@b.in',
              addressLine1: '1',
              city: 'Mumbai',
              state: 'Maharashtra',
              pinCode: '400001',
              country: 'India',
            },
            createdAt: '',
            updatedAt: '',
          },
        ],
        'prof_other',
        'aarav-mehta'
      )
    ).toBe(true);
  });
});

describe('Audit Log Filtering & Studio Preview Synchronization', () => {
  it('filters audit logs by preset, custom From/To date range, role, action, and keyword', () => {
    const nowMs = Date.parse('2026-11-17T12:00:00.000Z');
    const logs: AuditLogRecord[] = [
      {
        logId: 'log_1',
        actorUid: 'u1',
        actorEmail: 'admin@tapnex.in',
        actorRole: 'ADMIN',
        action: 'SAVE_CARD_TEMPLATE',
        targetCollection: 'cardTemplates',
        targetId: 'tpl-navy',
        details: 'Updated Corporate Black price',
        createdAt: '2026-11-17T08:00:00.000Z',
      },
      {
        logId: 'log_2',
        actorUid: 'u2',
        actorEmail: 'super@tapnex.in',
        actorRole: 'SUPERADMIN',
        action: 'DELETE_CARD_DESIGN',
        targetCollection: 'cardDesigns',
        targetId: 'des_99',
        details: 'Removed duplicate draft design',
        createdAt: '2026-11-13T10:00:00.000Z',
      },
      {
        logId: 'log_3',
        actorUid: 'u3',
        actorEmail: 'ops@tapnex.in',
        actorRole: 'ADMIN',
        action: 'DELETE_DIGITAL_PROFILE',
        targetCollection: 'profiles',
        targetId: 'prof_old',
        details: 'Deleted old profile',
        createdAt: '2026-10-01T09:00:00.000Z',
      },
    ];

    expect(filterAuditLogs(logs, { preset: 'ALL', nowMs })).toHaveLength(3);
    expect(filterAuditLogs(logs, { preset: 'LAST_24H', nowMs }).map((l) => l.logId)).toEqual(['log_1']);
    expect(filterAuditLogs(logs, { preset: 'LAST_7D', nowMs }).map((l) => l.logId)).toEqual(['log_1', 'log_2']);
    expect(
      filterAuditLogs(logs, {
        preset: 'CUSTOM',
        fromDate: '2026-11-12',
        toDate: '2026-11-15',
        nowMs,
      }).map((l) => l.logId)
    ).toEqual(['log_2']);
    expect(filterAuditLogs(logs, { preset: 'ALL', role: 'SUPERADMIN', nowMs }).map((l) => l.logId)).toEqual([
      'log_2',
    ]);
    expect(filterAuditLogs(logs, { preset: 'ALL', keyword: 'corporate', nowMs }).map((l) => l.logId)).toEqual([
      'log_1',
    ]);
  });

  it('resolves the active Studio card design whenever newer than the last saved Firestore design', () => {
    const baseTpl = DEFAULT_CARD_TEMPLATES[0];
    const altTpl = DEFAULT_CARD_TEMPLATES[1];
    const savedDesign: CardDesignRecord = {
      designId: 'des_saved_1',
      uid: 'u1',
      profileId: 'prof_1',
      templateId: baseTpl.templateId,
      frontDesign: baseTpl.frontSpec,
      backDesign: baseTpl.backSpec,
      cardOrientation: 'landscape',
      dimensions: '85.6x54mm',
      bleed: '3mm',
      approved: true,
      locked: false,
      version: 1,
      createdAt: '2026-11-10T10:00:00.000Z',
      updatedAt: '2026-11-10T10:00:00.000Z',
    };

    const resolvedNewerDraft = resolveEffectiveCardDesign({
      savedDesign,
      savedTimestampMs: Date.parse('2026-11-10T10:00:00.000Z'),
      localDraft: {
        profileId: 'prof_1',
        templateId: altTpl.templateId,
        templateName: altTpl.name,
        cardOrientation: 'vertical',
        frontDesign: altTpl.frontSpec,
        backDesign: altTpl.backSpec,
        updatedMs: Date.parse('2026-11-17T09:00:00.000Z'),
      },
      uid: 'u1',
      profileId: 'prof_1',
    });

    expect(resolvedNewerDraft?.templateId).toBe(altTpl.templateId);
    expect(resolvedNewerDraft?.cardOrientation).toBe('vertical');

    const resolvedOlderDraft = resolveEffectiveCardDesign({
      savedDesign,
      savedTimestampMs: Date.parse('2026-11-17T12:00:00.000Z'),
      localDraft: {
        profileId: 'prof_1',
        templateId: altTpl.templateId,
        templateName: altTpl.name,
        cardOrientation: 'vertical',
        frontDesign: altTpl.frontSpec,
        backDesign: altTpl.backSpec,
        updatedMs: Date.parse('2026-11-17T09:00:00.000Z'),
      },
      uid: 'u1',
      profileId: 'prof_1',
    });

    expect(resolvedOlderDraft?.templateId).toBe(baseTpl.templateId);
    expect(resolvedOlderDraft?.cardOrientation).toBe('landscape');
  });
});

describe('Direct URL QR Generator & Auto Print Auth ID', () => {
  it('generates print-grade QR SVG and data URL directly without requiring a backend endpoint', async () => {
    const artwork = await generateHighResQrArtwork('https://tapnex.in/p/jeet-kulkarni', 1024);
    expect(artwork.targetUrl).toBe('https://tapnex.in/p/jeet-kulkarni');
    expect(artwork.svgContent).toContain('<svg');
    expect(artwork.svgContent.length).toBeLessThan(100000);
    expect(artwork.pngDataUrl.startsWith('data:image/')).toBe(true);
  });

  it('auto-generates Print Auth IDs compatible with Firestore document ID rules', () => {
    const id1 = generatePrinterAuthId();
    const id2 = generatePrinterAuthId();
    expect(id1).toMatch(/^prt_[a-z0-9]+_[a-z0-9]+$/);
    expect(id2).toMatch(/^[a-zA-Z0-9_\-]+$/);
    expect(id1.length).toBeGreaterThanOrEqual(6);
    expect(id1).not.toBe(id2);
  });

  it('ensures firestore.rules supports verified users and null-safe cardDesigns lookup', () => {
    const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
    expect(rules).toContain("!(get(/databases/$(database)/documents/users/$(request.auth.uid)).data.status in ['Blocked', 'Disabled'])");
    expect(rules).toContain("existing().status == 'Pending Verification' && isVerified() && incoming().status == 'Active'");
    expect(rules).toContain('resource == null ? isSignedIn()');
  });
});

describe('Workspace Factory Reset & SuperAdmin Wipe Safeguards', () => {
  it('covers all operational collections and enforces SuperAdmin role guard', async () => {
    expect(RESETTABLE_OPERATIONAL_COLLECTIONS).toEqual([
      'orders',
      'payments',
      'qrCodes',
      'shippingRecords',
      'cardDesigns',
      'supportTickets',
      'notifications',
      'printers',
      'profiles',
      'publicProfiles',
      'auditLogs',
    ]);

    await expect(
      resetApplicationToFreshBlank({ uid: 'u_admin', email: 'admin@tapnex.in', role: 'ADMIN' })
    ).rejects.toThrow('Only SuperAdmin accounts can reset all application data.');
  });

  it('verifies firestore.rules allows SuperAdmin cleanup on auditLogs while blocking updates and self-deletion', () => {
    const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
    expect(rules).toContain('allow update: if false;');
    expect(rules).toContain('allow delete: if isValidId(logId) && isSuperAdmin();');
    expect(rules).toContain('allow delete: if isValidId(uid) && isSuperAdmin() && uid != request.auth.uid;');
  });
});

describe('Platform Complete User Role Guide Coverage', () => {
  it('covers all five user roles with annotated screenshots and step-by-step workflows', () => {
    expect(ROLE_CAPABILITY_MATRIX).toHaveLength(5);
    expect(ROLE_GUIDES.map((r) => r.roleId)).toEqual([
      'public',
      'customer',
      'printer',
      'admin',
      'superadmin',
    ]);

    const seenScenes = new Set<string>();
    for (const role of ROLE_GUIDES) {
      expect(role.features.length).toBeGreaterThanOrEqual(1);
      for (const feat of role.features) {
        expect(feat.route.length).toBeGreaterThan(0);
        expect(feat.callouts).toHaveLength(4);
        expect(feat.callouts.map((c) => c.num)).toEqual([1, 2, 3, 4]);
        expect(feat.steps.length).toBeGreaterThanOrEqual(4);
        expect(feat.notes.length).toBeGreaterThanOrEqual(1);
        expect(seenScenes.has(feat.screenshotId)).toBe(false);
        seenScenes.add(feat.screenshotId);
      }
    }
    expect(seenScenes.size).toBe(8);
  });
});

describe('Outer Google Sign-In Concurrency & Rule Safeguards', () => {
  it('enforces deduplicated user sync and non-blocking profile creation in AuthContext', () => {
    const authSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/contexts/AuthContext.tsx'), 'utf8');
    expect(authSrc).toContain('inflightSyncRef');
    expect(authSrc).toContain('ensureDefaultProfile(newUser).catch');
    expect(authSrc).toContain('fbUser.photoURL.length <= 2048');
  });

  it('permits regular and pre-registered Google users to create users/{uid} safely in firestore.rules', () => {
    const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
    expect(rules).toContain("incoming().role == 'USER' && incoming().status in ['Pending Verification', 'Active']");
    expect(rules).toContain("incoming().role == get(/databases/$(database)/documents/admins/$(request.auth.uid)).data.role");
  });

  it('clamps fallback profile slugs within Firestore 64-char limit', () => {
    const longName = 'A'.repeat(100);
    const cleaned = sanitizeSlug(longName);
    expect(cleaned.length).toBeLessThanOrEqual(60);
    const suffixed = `${cleaned.slice(0, 54).replace(/-+$/, '')}-ab12`;
    expect(suffixed.length).toBeLessThanOrEqual(64);
  });
});

describe('Multi-Gateway Payments, Blank Template Studio & Admin Profile Approval', () => {
  it('merges partial payment gateway settings safely across all 6 gateways without storing secrets', () => {
    const merged = mergePaymentGateways({
      razorpay: {
        id: 'razorpay',
        label: 'Razorpay',
        enabled: false,
        mode: 'live',
        publicKeyId: 'rzp_live_123',
      },
      gpay: {
        id: 'gpay',
        label: 'Google Pay (GPay)',
        enabled: true,
        mode: 'live',
        upiId: 'business@okaxis',
      },
    });

    expect(Object.keys(merged)).toEqual(PAYMENT_GATEWAY_ORDER);
    expect(merged.razorpay.enabled).toBe(false);
    expect(merged.razorpay.mode).toBe('live');
    expect(merged.razorpay.publicKeyId).toBe('rzp_live_123');
    expect(merged.cashfree.enabled).toBe(true);
    expect(merged.easebuzz.mode).toBe('sandbox');
    expect(merged.gpay.upiId).toBe('business@okaxis');
  });

  it('constructs BLANK_CARD_TEMPLATE with customizable front/back NFC slot and maxWidthPct elements', () => {
    expect(BLANK_CARD_TEMPLATE.templateId).toBe('blank-custom');
    const blankFront = createBlankSideDesign('front', 'data:image/png;base64,abc');
    expect(blankFront.backgroundImageUrl).toBe('data:image/png;base64,abc');
    expect(typeof blankFront.nfcX).toBe('number');
    expect(typeof blankFront.nfcY).toBe('number');
    expect(typeof blankFront.nfcSizeMm).toBe('number');
    expect(blankFront.elements.every((el) => typeof el.maxWidthPct === 'number')).toBe(true);
  });

  it('preserves adminApproved metadata on buildSanitizedPublicProfile and enforces anti-spoof rules in firestore.rules', () => {
    const approvedProfile = makeSampleProfile({
      adminApproved: true,
      adminApprovedAt: '2026-11-21T10:00:00.000Z',
      adminApprovedBy: 'admin_uid_1',
    });
    const pub = buildSanitizedPublicProfile(approvedProfile);
    expect(pub.adminApproved).toBe(true);
    expect(pub.adminApprovedBy).toBe('admin_uid_1');

    const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
    expect(rules).toContain("'cashfree_live', 'cashfree_sandbox'");
    expect(rules).toContain("'easebuzz_live', 'easebuzz_sandbox'");
    expect(rules).toContain("'payu_live', 'payu_sandbox'");
    expect(rules).toContain("'gpay_live', 'gpay_sandbox'");
    expect(rules).toContain("'upi_live', 'upi_sandbox'");
    expect(rules).toContain("incoming().get('adminApproved', false) == false");
    expect(rules).toContain("incoming().get('adminApproved', false) == existing().get('adminApproved', false)");
  });
});

describe('Editable Card Templates & Shape Elements', () => {
  const NEW_TEMPLATE_IDS = [
    'gold-obsidian-split',
    'royal-badge-vertical',
    'champagne-diagonal',
    'noir-gold-arc',
    'slate-wave-minimal',
    'sand-taupe-signature',
    'cream-terracotta-atelier',
  ];

  it('includes all 7 new fully-editable templates in DEFAULT_CARD_TEMPLATES with valid shapes', () => {
    const ids = DEFAULT_CARD_TEMPLATES.map((t) => t.templateId);
    for (const id of NEW_TEMPLATE_IDS) {
      expect(ids).toContain(id);
      const tpl = DEFAULT_CARD_TEMPLATES.find((t) => t.templateId === id)!;
      expect(tpl.frontSpec.elements.length).toBeGreaterThan(0);
      expect(tpl.backSpec.elements.length).toBeGreaterThan(0);
      const totalShapes = (tpl.frontSpec.shapes?.length || 0) + (tpl.backSpec.shapes?.length || 0);
      expect(totalShapes).toBeGreaterThan(0);
      for (const shape of [...(tpl.frontSpec.shapes || []), ...(tpl.backSpec.shapes || [])]) {
        expect(['rect', 'circle', 'line', 'pill']).toContain(shape.kind);
        expect(typeof shape.xPct).toBe('number');
        expect(typeof shape.yPct).toBe('number');
        expect(typeof shape.widthPct).toBe('number');
        expect(typeof shape.heightPct).toBe('number');
        expect(shape.color).toMatch(/^(#[0-9a-fA-F]{3,8}|transparent)$/);
      }
    }
  });

  it('keeps all templates free of hardcoded sample personal names or phone numbers', () => {
    const forbiddenLiterals = ['Jane Doe', 'Michal Johns', 'Mina Nguyen', 'Olivia Wilson', 'Jonathan', 'Aaron Loeb'];
    for (const tpl of DEFAULT_CARD_TEMPLATES) {
      const texts = [
        ...tpl.frontSpec.elements.map((e) => e.text),
        ...tpl.backSpec.elements.map((e) => e.text),
      ];
      for (const txt of texts) {
        for (const forbidden of forbiddenLiterals) {
          expect(txt.toLowerCase()).not.toContain(forbidden.toLowerCase());
        }
      }
      if (tpl.frontSpec.showAvatar && tpl.frontSpec.avatarShape) {
        expect(['circle', 'rounded', 'square']).toContain(tpl.frontSpec.avatarShape);
      }
    }
  });

  it('registers Azure Tech Waves background as the sole default template and prioritizes default first in sortCardTemplates', () => {
    const azure = DEFAULT_CARD_TEMPLATES.find((t) => t.templateId === 'azure-tech-waves');
    expect(azure).toBeDefined();
    expect(azure!.isDefault).toBe(true);
    expect(azure!.active).toBe(true);
    expect(azure!.frontSpec.backgroundImageUrl).toBe(
      '/assets/aistudio/Abstract_blue_healthcare_technology_waves_d3f00c1d.webp'
    );
    expect(azure!.backSpec.backgroundImageUrl).toBe(
      '/assets/aistudio/Abstract_blue_healthcare_technology_waves_d3f00c1d.webp'
    );

    const defaults = DEFAULT_CARD_TEMPLATES.filter((t) => t.isDefault);
    expect(defaults.map((t) => t.templateId)).toEqual(['azure-tech-waves']);

    const sortedWithCustomDefault = sortCardTemplates([
      ...DEFAULT_CARD_TEMPLATES.filter((t) => t.templateId !== 'minimal-white').map((t) => ({
        ...t,
        isDefault: false,
      })),
      { ...DEFAULT_CARD_TEMPLATES.find((t) => t.templateId === 'minimal-white')!, isDefault: true },
    ]);
    expect(sortedWithCustomDefault[0].templateId).toBe('minimal-white');
  });
});

describe('Design Studio Layout Engine, Rich Bio Sanitizer & Link Controls', () => {
  it('wraps long card text lines accurately using wrapCanvasTextLines', () => {
    const measure = (txt: string) => txt.length * 10;
    const wrapped = wrapCanvasTextLines(measure, 'TapNex Smart Business Identity Systems', 120);
    expect(wrapped.length).toBeGreaterThan(1);
    for (const line of wrapped) {
      expect(measure(line)).toBeLessThanOrEqual(120);
    }

    const longWord = wrapCanvasTextLines(measure, 'https://verylongcustomdomainexample.tapnex.in/profile', 100);
    expect(longWord.length).toBeGreaterThan(2);
    for (const line of longWord) {
      expect(measure(line)).toBeLessThanOrEqual(100);
    }
  });

  it('aligns multiple selected elements, snaps to alignment guidelines, and nudges cleanly', () => {
    const baseSide = createBlankSideDesign('front');
    const customSide = {
      ...baseSide,
      elements: [
        { ...baseSide.elements[0], id: 'el_a', xPct: 10, yPct: 20, maxWidthPct: 30 },
        { ...baseSide.elements[1], id: 'el_b', xPct: 40, yPct: 50, maxWidthPct: 30 },
      ],
    };

    const alignedLeft = alignTargetsOnSide(
      customSide,
      [
        { kind: 'text', id: 'el_a' },
        { kind: 'text', id: 'el_b' },
      ],
      'left',
      'landscape'
    );
    expect(alignedLeft.elements[0].xPct).toBe(10);
    expect(alignedLeft.elements[1].xPct).toBe(10);

    const alignedTop = alignTargetsOnSide(
      customSide,
      [
        { kind: 'text', id: 'el_a' },
        { kind: 'text', id: 'el_b' },
      ],
      'top',
      'landscape'
    );
    expect(alignedTop.elements[0].yPct).toBe(20);
    expect(alignedTop.elements[1].yPct).toBe(20);

    const snapped = computeSnapAndGuidelines({
      side: customSide,
      movingTarget: { kind: 'text', id: 'el_a' },
      candidateX: 40.5,
      candidateY: 49.4,
      orientation: 'landscape',
    });
    expect(snapped.snappedX).toBe(40);
    expect(snapped.snappedY).toBe(50);
    expect(snapped.verticalGuides.length).toBeGreaterThan(0);
    expect(snapped.horizontalGuides.length).toBeGreaterThan(0);

    const nudgedFine = nudgeTargetsOnSide(
      customSide,
      [{ kind: 'text', id: 'el_a' }],
      0.25,
      -0.25
    );
    expect(nudgedFine.elements[0].xPct).toBe(10.25);
    expect(nudgedFine.elements[0].yPct).toBe(19.75);
    expect(nudgedFine.elements[1].xPct).toBe(40);
  });

  it('sanitizes rich text biography HTML strictly and preserves safe formatting & hex colors', () => {
    expect(normalizeHexColor('#abc')).toBe('#AABBCC');
    expect(normalizeHexColor('1d4ed8')).toBe('#1D4ED8');
    expect(normalizeHexColor('javascript:alert(1)')).toBeNull();

    const dirty =
      '<div style="text-align: center" onclick="alert(1)"><strong style="color: #1D4ED8">AI Architect</strong><script>steal()</script><img src="x" onerror="xss()" /> &amp; <em>Founder</em></div>';
    const clean = sanitizeRichBioHtml(dirty);
    expect(clean).toContain('text-align: center');
    expect(clean).toContain('<strong style="color: #1D4ED8">AI Architect</strong>');
    expect(clean).toContain('<em>Founder</em>');
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('onerror');
    expect(clean).not.toContain('<img');

    const plain = stripHtmlToPlainText(clean);
    expect(plain).toBe('AI Architect & Founder');
  });

  it('strips rich bio HTML tags when exporting vCard (.vcf) and enforces SMART Help + adminDisabled in firestore.rules', () => {
    const profileWithRichBio = makeSampleProfile({
      personalInformation: {
        ...makeSampleProfile().personalInformation,
        shortBio: '<p><strong>Executive</strong> <em>Advisor</em><br />Pune</p>',
      },
    });
    const pub = buildSanitizedPublicProfile(profileWithRichBio) as Parameters<typeof buildPublicVCard>[0];
    const vcf = buildPublicVCard(pub, 'https://tapnex.in/p/aarav-mehta');
    expect(vcf).toContain('NOTE:Executive Advisor Pune');
    expect(vcf).not.toContain('<strong>');

    const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
    expect(rules).toContain("'SMART Help'");
    expect(rules).toContain('adminDisabled');
  });

  it('hides photo frames and avoids round circle defaults on front and back across templates and blank designs', () => {
    for (const side of [createBlankSideDesign('front'), createBlankSideDesign('back')]) {
      expect(side.showAvatar).toBe(false);
      expect(side.avatarShape).toBe('square');
    }
    for (const tpl of [BLANK_CARD_TEMPLATE, ...DEFAULT_CARD_TEMPLATES]) {
      expect(Boolean(tpl.frontSpec.showAvatar)).toBe(false);
      expect(Boolean(tpl.backSpec.showAvatar)).toBe(false);
      expect(tpl.frontSpec.avatarShape).not.toBe('circle');
      expect(tpl.backSpec.avatarShape).not.toBe('circle');
    }
  });

  it('uses Download PDF label and provides separate Front PNG / Back PNG export actions in Admin & Printer portals', () => {
    const printPdfSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/printPdf.ts'), 'utf8');
    expect(printPdfSrc).toContain('export async function generateCardSidePngBlob');

    for (const relPath of [
      'src/pages/printer/PrinterPortalPages.tsx',
      'src/pages/admin/AdminPortalPages.tsx',
    ]) {
      const src = fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
      expect(src).toContain('Download PDF');
      expect(src).toContain('Front PNG');
      expect(src).toContain('Back PNG');
      expect(src).not.toContain('Download 300 DPI Print PDF');
      expect(src).not.toContain('>300 DPI PDF<');
    }
  });

  it('treats Delivered orders as unlocked even with Pending payment, removes shield restrictions when live, and keeps /p/:slug public without login', () => {
    const deliveredPendingOrder = {
      orderId: 'ord_delivered_1',
      orderNumber: 'TNX-2026-999001',
      uid: 'user_1',
      profileId: 'prof_personal',
      profileSlug: 'personal',
      designId: 'des_1',
      quantity: 1,
      cardType: 'Matte PVC SMART',
      subtotal: 1200,
      tax: 216,
      shipping: 0,
      total: 1416,
      currency: 'INR' as const,
      paymentStatus: 'Pending' as const,
      orderStatus: 'Delivered' as const,
      shippingAddress: {
        fullName: 'Test User',
        mobile: '+91 9876543210',
        email: 'test@example.com',
        addressLine1: 'MG Road',
        city: 'Pune',
        state: 'Maharashtra',
        pinCode: '411001',
        country: 'India',
      },
      createdAt: '2026-01-01',
      updatedAt: '2026-01-02',
    };

    const inTransitPendingOrder = {
      ...deliveredPendingOrder,
      orderId: 'ord_transit_1',
      orderStatus: 'In Transit' as const,
    };

    expect(isOrderPaymentConfirmed([deliveredPendingOrder], 'prof_personal')).toBe(true);
    expect(isOrderPaymentConfirmed([deliveredPendingOrder], undefined, 'personal')).toBe(true);
    expect(isOrderPaymentConfirmed([inTransitPendingOrder], 'prof_personal', 'personal')).toBe(false);

    const publicProfileSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/pages/public/PublicProfilePage.tsx'),
      'utf8'
    );
    expect(publicProfileSrc).toContain('<ScreenProtectionShield active={!isPaidLive}');
    expect(publicProfileSrc).toContain('reconcileDeliveredOrdersToProfiles');

    const customerProfileSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/pages/customer/CustomerProfilePages.tsx'),
      'utf8'
    );
    expect(customerProfileSrc).toContain('active={!effectiveLive}');

    const appSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(appSrc).toContain('<Route path="/p/:slug" element={<PublicProfilePage />} />');

    const rulesSrc = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
    expect(rulesSrc).toContain("orderStatus == 'Delivered'");
    expect(rulesSrc).toContain('match /publicProfiles/{slug}');
  });
});

describe('Smart Safety Tags Shop, Multi-Profile Types, Auto-Slugs & Family Reuse', () => {
  it('provides all 5 required Shop categories and Shop Firestore rules without any competitor text', () => {
    const names = DEFAULT_SHOP_CATEGORIES.map((c) => c.name);
    expect(names).toEqual([
      'Helmet Tags / Stickers',
      'Pet Tags',
      'Personal Belonging Tags / Stickers',
      'Kids Tags',
      'Find My Owner Tags',
    ]);
    for (const cat of DEFAULT_SHOP_CATEGORIES) {
      expect(DEFAULT_SHOP_PRODUCTS.some((p) => p.categoryId === cat.categoryId && p.visibleOnShop)).toBe(true);
    }

    const rulesSrc = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
    expect(rulesSrc).toContain('match /shopCategories/{categoryId}');
    expect(rulesSrc).toContain('match /shopProducts/{productId}');
    expect(rulesSrc).toContain("in ['studio', 'shop']");
    expect(rulesSrc).toContain("== 'shop'");

    const shopSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/public/ShopPage.tsx'), 'utf8');
    expect(shopSrc.toLowerCase()).not.toContain('tageze');
  });

  it('auto-generates safe unique-format slugs and selectively copies reusable family profile fields', () => {
    const namedSlug = generateAutoProfileSlug('Aarav Mehta');
    expect(namedSlug).toMatch(/^aarav-mehta-[a-z0-9]{4,6}$/);
    expect(namedSlug.length).toBeLessThanOrEqual(64);

    const fallbackSlug = generateAutoProfileSlug('');
    expect(fallbackSlug).toMatch(/^tpnx-[a-z0-9]+$/);

    const copied = copyProfileFieldsBySelection(
      {
        fullName: 'Priya Sharma',
        mobile: '+91 98201 11223',
        whatsapp: '+91 98201 11223',
        email: 'priya@example.com',
        personalAddress: '204 Marine Lines',
        city: 'Mumbai',
        state: 'Maharashtra',
        pinCode: '400020',
        country: 'India',
        emergencyContactName: 'Rohan Sharma',
        emergencyContactPhone: '+91 98201 99887',
      },
      {
        address: true,
        parentContact: true,
        emergencyContact: true,
        mobile: false,
        email: false,
      }
    );

    expect(copied.personalAddress).toBe('204 Marine Lines');
    expect(copied.city).toBe('Mumbai');
    expect(copied.parentName).toBe('Priya Sharma');
    expect(copied.parentMobile).toBe('+91 98201 11223');
    expect(copied.emergencyContactName).toBe('Rohan Sharma');
    expect(copied.mobile).toBeUndefined();
    expect(copied.email).toBeUndefined();
    expect(copied.fullName).toBeUndefined();
  });

  it('isolates adult-only professional/government fields from kids, pets, and belongings public profiles', () => {
    const kidsProfile = makeSampleProfile({
      profileType: 'kids',
      personalInformation: {
        ...makeSampleProfile().personalInformation,
        fullName: 'Riya Mehta',
        schoolOrClass: 'Grade 4 - Oakridge',
        parentName: 'Aarav Mehta',
        parentMobile: '+91 98201 44510',
        bloodGroup: 'O+',
        allergiesOrMedical: 'Peanut allergy',
        aadhaarNumber: '1234 5678 9012',
        panNumber: 'ABCDE1234F',
      },
      visibilitySettings: {
        ...DEFAULT_VISIBILITY,
        parentContact: true,
        schoolOrClass: true,
        bloodGroup: true,
        medicalInfo: true,
      },
    });
    const pubKids = buildSanitizedPublicProfile(kidsProfile);
    expect(pubKids.profileType).toBe('kids');
    expect(pubKids.personalInformation?.parentName).toBe('Aarav Mehta');
    expect(pubKids.personalInformation?.schoolOrClass).toBe('Grade 4 - Oakridge');
    expect(pubKids.personalInformation?.bloodGroup).toBe('O+');
    expect(pubKids.personalInformation?.allergiesOrMedical).toBe('Peanut allergy');
    expect(pubKids.personalInformation?.jobTitle).toBeUndefined();
    expect(pubKids.personalInformation?.companyName).toBeUndefined();
    expect(pubKids.personalInformation?.aadhaarNumber).toBeUndefined();
    expect(pubKids.personalInformation?.panNumber).toBeUndefined();

    const petsProfile = makeSampleProfile({
      profileType: 'pets',
      personalInformation: {
        ...makeSampleProfile().personalInformation,
        fullName: 'Bruno',
        petType: 'Dog',
        breed: 'Golden Retriever',
        microchipId: 'IND-9001234',
        ownerName: 'Aarav Mehta',
        ownerMobile: '+91 98201 44510',
        vetPhone: '+91 98111 22334',
      },
    });
    const pubPets = buildSanitizedPublicProfile(petsProfile);
    expect(pubPets.profileType).toBe('pets');
    expect(pubPets.personalInformation?.petType).toBe('Dog');
    expect(pubPets.personalInformation?.breed).toBe('Golden Retriever');
    expect(pubPets.personalInformation?.microchipId).toBe('IND-9001234');
    expect(pubPets.personalInformation?.jobTitle).toBeUndefined();
  });

  it('resolves Kids, Pets, and Belongings tokens in resolveCardTokens', () => {
    const out = resolveCardTokens(
      '{{PARENT_NAME}} | {{SCHOOL_CLASS}} | {{BLOOD_GROUP}} | {{PET_TYPE}} | {{BREED}} | {{ITEM_CATEGORY}} | {{SERIAL_NUMBER}} | {{FINDER_NOTES}}',
      {
        parentName: 'Neha Rao',
        schoolOrClass: 'Class 3B',
        bloodGroup: 'B+',
        petType: 'Cat',
        breed: 'Siamese',
        itemCategory: 'Laptop Bag',
        serialNumber: 'SN-7788',
        finderNotes: 'Reward offered',
      }
    );
    expect(out).toBe('Neha Rao | Class 3B | B+ | Cat | Siamese | Laptop Bag | SN-7788 | Reward offered');

    const otherOut = resolveCardTokens('{{ITEM_CATEGORY}}', {
      itemCategory: 'Other',
      itemCategoryOther: 'Camera Tripod',
    });
    expect(otherOut).toBe('Camera Tripod');

    const otherBelongingProfile = makeSampleProfile({
      profileType: 'belongings',
      personalInformation: {
        ...makeSampleProfile().personalInformation,
        fullName: 'Field Gear',
        itemCategory: 'Other',
        itemCategoryOther: 'Camera Tripod',
      },
    });
    const pubBelonging = buildSanitizedPublicProfile(otherBelongingProfile);
    expect(pubBelonging.personalInformation?.itemCategory).toBe('Other');
    expect(pubBelonging.personalInformation?.itemCategoryOther).toBe('Camera Tripod');
  });

  it('provides Netlify SPA fallback assets and scopes User Guide away from admin/superadmin for normal users', () => {
    const redirectsSrc = fs.readFileSync(path.resolve(process.cwd(), 'public/_redirects'), 'utf8');
    expect(redirectsSrc).toContain('/index.html');
    const html404Src = fs.readFileSync(path.resolve(process.cwd(), 'public/404.html'), 'utf8');
    expect(html404Src).toContain('tapnex_spa_redirect');
    const appSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(appSrc).toContain('/p/:slug/*');

    const guidePageSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/public/UserGuidePage.tsx'), 'utf8');
    expect(guidePageSrc).toContain('getAllowedGuideRolesForUser');
    expect(guidePageSrc).toContain("return ['public', 'customer']");
  });

  it('populates default card templates with editable profile values, tracks fieldKey across edits, and spaces toggled fields cleanly', () => {
    const profile = makeSampleProfile();
    const effInfo = buildEffectiveProfileInfo(profile, {
      displayName: 'Account Fallback Name',
      email: 'account@tapnex.in',
      phone: '+91 90000 11111',
    });
    expect(effInfo.fullName).toBe('Aarav Mehta');

    const freshEffInfo = buildEffectiveProfileInfo(
      {
        profileType: 'adult',
        personalInformation: { ...profile.personalInformation, fullName: '', email: '', mobile: '' },
      },
      {
        displayName: 'Priya Nair',
        email: 'priya@eisora.in',
        phone: '+91 98111 22334',
      }
    );
    expect(freshEffInfo.fullName).toBe('Priya Nair');
    expect(freshEffInfo.email).toBe('priya@eisora.in');
    expect(freshEffInfo.mobile).toBe('+91 98111 22334');

    const defaultTpl = DEFAULT_CARD_TEMPLATES.find((t) => t.isDefault) || DEFAULT_CARD_TEMPLATES[0];
    const filledFront = populateSideWithProfileInfo(defaultTpl.frontSpec, effInfo);
    const filledBack = populateSideWithProfileInfo(defaultTpl.backSpec, effInfo);

    // Every filled token on default template becomes directly editable real text with fieldKey attached
    const nameEl = filledFront.elements.find((e) => e.fieldKey === 'fullName');
    expect(nameEl).toBeDefined();
    expect(nameEl!.text).toBe('Aarav Mehta');

    const mobileEl = filledBack.elements.find((e) => e.fieldKey === 'mobile');
    expect(mobileEl).toBeDefined();
    expect(mobileEl!.text).toBe('+91 98201 44510');

    // Checkbox remains checked even after custom editing the materialized text
    const customizedBack = {
      ...filledBack,
      elements: filledBack.elements.map((e) =>
        e.id === mobileEl!.id ? { ...e, text: '+91 98201 44510 (Work)' } : e
      ),
    };
    expect(
      doesSideContainField(customizedBack, { key: 'mobile', insertText: '{{MOBILE}}' })
    ).toBe(true);

    // Multi-token kids template strings stay tracked for individual fields across front & back
    const kidsTpl = DEFAULT_CARD_TEMPLATES.find((t) => t.profileType === 'kids')!;
    const filledKidsFront = populateSideWithProfileInfo(kidsTpl.frontSpec, {
      fullName: 'Riya Rao',
      parentName: 'Neha Rao',
      parentMobile: '+91 98201 00001',
    });
    expect(filledKidsFront.elements.some((e) => e.text.includes('Neha Rao'))).toBe(true);
    expect(
      doesSideContainField(filledKidsFront, { key: 'parentName', insertText: '{{PARENT_NAME}}' })
    ).toBe(true);

    const filledKidsBack = populateSideWithProfileInfo(kidsTpl.backSpec, {
      emergencyContactName: 'Neha Rao',
      emergencyContactPhone: '+91 98201 00001',
    });
    expect(
      doesSideContainField(filledKidsBack, {
        key: 'emergencyContactName',
        insertText: '{{EMERGENCY_NAME}}',
      })
    ).toBe(true);
    expect(
      doesSideContainField(filledKidsBack, {
        key: 'emergencyContactPhone',
        insertText: '{{EMERGENCY_PHONE}}',
      })
    ).toBe(true);

    // Older drafts with unresolved tokens pick up newly filled profile data without altering custom edits
    const legacyDraft = {
      ...defaultTpl.backSpec,
      elements: defaultTpl.backSpec.elements.map((el) =>
        el.text === '{{EMAIL}}' ? { ...el, text: 'custom-unchanged@tapnex.in' } : el
      ),
    };
    const refreshed = refreshUneditedSideWithProfileInfo(legacyDraft, effInfo);
    expect(refreshed.elements.some((el) => el.text === 'custom-unchanged@tapnex.in')).toBe(true);
    expect(refreshed.elements.some((el) => el.text === '+91 98201 44510')).toBe(true);

    // Clean slot allocator stays away from occupied y rows and right-hand QR area
    const nextSlot = getNextCleanCardTextSlot(filledBack);
    expect(nextSlot.maxWidthPct).toBeLessThanOrEqual(82);
    expect(nextSlot.xPct).toBeLessThan(filledBack.qrSlotX);

    const studioSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/pages/customer/CustomerStudioCheckoutPages.tsx'),
      'utf8'
    );
    expect(studioSrc).toContain('Information to Display on Card');
    expect(studioSrc).toContain('doesSideContainField');
  });

  it('validates payment gateway ID & Key pairs cleanly with PASS/FAIL verdicts and server endpoint', () => {
    expect(
      validateGatewayCredentials({
        gateway: 'razorpay',
        mode: 'sandbox',
        publicKeyId: 'rzp_test_12345678',
        secretKey: 'secret12345',
      })
    ).toMatchObject({ ok: true, verdict: 'PASS' });

    expect(
      validateGatewayCredentials({
        gateway: 'razorpay',
        mode: 'live',
        publicKeyId: 'rzp_test_wrongmode',
        secretKey: 'secret12345',
      })
    ).toMatchObject({ ok: false, verdict: 'FAIL' });

    expect(
      validateGatewayCredentials({
        gateway: 'cashfree',
        mode: 'sandbox',
        publicKeyId: 'CF_APP_998877',
        secretKey: 'cf_secret_key_123',
      })
    ).toMatchObject({ ok: true, verdict: 'PASS' });

    expect(
      validateGatewayCredentials({
        gateway: 'upi',
        merchantId: 'TAPNEX01',
        upiId: 'tapnex@okaxis',
      })
    ).toMatchObject({ ok: true, verdict: 'PASS' });

    expect(
      validateGatewayCredentials({
        gateway: 'gpay',
        merchantId: 'AB',
        upiId: 'invalid-vpa',
      })
    ).toMatchObject({ ok: false, verdict: 'FAIL' });

    const serverSrc = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf8');
    expect(serverSrc).toContain('/api/payments/test-gateway');
    expect(serverSrc).toContain('validateGatewayCredentials');

    const panelSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/PaymentGatewaySettingsPanel.tsx'),
      'utf8'
    );
    expect(panelSrc).toContain('Test Connection');
    expect(panelSrc).toContain('labels.idLabel');
    expect(panelSrc).toContain('labels.keyLabel');
    expect(panelSrc).toContain('<span>PASS</span>');
    expect(panelSrc).toContain('<span>FAIL</span>');
  });

  it('resolves exact Minimal/Designer QR & Smart Card tiers plus Dog Tag (2-pack) and Helmet Sticker (2-pack) pricing', () => {
    const minimalTpl = DEFAULT_CARD_TEMPLATES.find((t) => t.templateId === 'azure-tech-waves')!;
    const designerTpl = DEFAULT_CARD_TEMPLATES.find((t) => t.templateId === 'premium-navy')!;
    const dogTpl = DEFAULT_CARD_TEMPLATES.find((t) => t.templateId === 'pet-dog-tag-classic')!;
    const helmetTpl = DEFAULT_CARD_TEMPLATES.find(
      (t) => t.templateId === 'belongings-helmet-sticker-round'
    )!;

    expect(
      DEFAULT_CARD_TEMPLATES.some((t) => t.templateId === 'belongings-helmet-accident-sos')
    ).toBe(false);

    expect(resolveCardPricing(minimalTpl, 'qr_only').unitPriceInr).toBe(499);
    expect(resolveCardPricing(minimalTpl, 'qr_smart').unitPriceInr).toBe(999);
    expect(resolveCardPricing(designerTpl, 'qr_only').unitPriceInr).toBe(599);
    expect(resolveCardPricing(designerTpl, 'qr_smart').unitPriceInr).toBe(1499);

    const dogPricing = resolveCardPricing(dogTpl, 'qr_smart');
    expect(dogPricing.pricingMode).toBe('fixed_pack');
    expect(dogPricing.unitPriceInr).toBe(599);
    expect(dogPricing.packNote?.toLowerCase()).toContain('2');
    expect(dogPricing.packNote?.toLowerCase()).toContain('belt not included');

    const helmetPricing = resolveCardPricing(helmetTpl, 'qr_smart');
    expect(helmetPricing.pricingMode).toBe('fixed_pack');
    expect(helmetPricing.unitPriceInr).toBe(299);
    expect(helmetPricing.packNote?.toLowerCase()).toContain('helmet');
    expect(helmetPricing.packNote?.toLowerCase()).toContain('bike');

    const shopHelmet = DEFAULT_SHOP_PRODUCTS.find((p) => p.productId === 'prod-helmet-safety-tag')!;
    const shopDog = DEFAULT_SHOP_PRODUCTS.find((p) => p.productId === 'prod-pet-collar-tag')!;
    expect(shopHelmet.priceInr).toBe(299);
    expect(shopDog.priceInr).toBe(599);
  });

  it('auto-matches Dog & Helmet Round templates, preserves editable artwork, and auto-fills & updates Pluto', () => {
    const dogTpl = DEFAULT_CARD_TEMPLATES.find((t) => t.templateId === 'pet-dog-tag-classic')!;
    const helmetTpl = DEFAULT_CARD_TEMPLATES.find(
      (t) => t.templateId === 'belongings-helmet-sticker-round'
    )!;

    expect(dogTpl).toBeDefined();
    expect(helmetTpl).toBeDefined();
    expect(dogTpl.frontSpec.logoDataUrl).toBe('/assets/aistudio/dog_tag_mascot.png');
    expect(dogTpl.frontSpec.elements.some((el) => el.curveDeg && el.uppercase)).toBe(true);
    expect(helmetTpl.frontSpec.logoDataUrl).toBe('/assets/aistudio/Helmet_sticker_round_99c28822.png');
    expect(helmetTpl.frontSpec.showQrSlot).toBe(true);

    const dogProfile = makeSampleProfile({
      profileType: 'pets',
      personalInformation: {
        ...makeSampleProfile().personalInformation,
        fullName: 'Pluto',
        petType: 'Dog',
        breed: 'Beagle',
        ownerName: 'Aarav Mehta',
        ownerMobile: '+91 98201 44510',
      },
    });
    const matchedDog = selectDefaultTemplateForProfile(dogProfile, DEFAULT_CARD_TEMPLATES);
    expect(matchedDog?.templateId).toBe('pet-dog-tag-classic');

    const filledDogFront = populateSideWithProfileInfo(
      dogTpl.frontSpec,
      buildEffectiveProfileInfo(dogProfile)
    );
    expect(filledDogFront.elements.some((e) => e.text === 'Pluto')).toBe(true);

    // Updating the profile name re-syncs unedited auto-filled dog tag text while leaving edited elements intact
    const updatedDogFront = refreshUneditedSideWithProfileInfo(filledDogFront, {
      ...buildEffectiveProfileInfo(dogProfile),
      fullName: 'Bruno',
    });
    expect(updatedDogFront.elements.some((e) => e.text === 'Bruno')).toBe(true);

    const helmetProfile = makeSampleProfile({
      profileType: 'belongings',
      personalInformation: {
        ...makeSampleProfile().personalInformation,
        fullName: 'Rohan Joshi',
        itemCategory: 'Helmet',
        bloodGroup: 'O+',
        emergencyContactPhone: '+91 98111 22334',
        finderNotes: 'Call emergency contact immediately',
      },
    });
    const matchedHelmet = selectDefaultTemplateForProfile(helmetProfile, DEFAULT_CARD_TEMPLATES);
    expect(matchedHelmet?.templateId).toBe('belongings-helmet-sticker-round');

    const filledHelmetBack = populateSideWithProfileInfo(
      helmetTpl.backSpec,
      buildEffectiveProfileInfo(helmetProfile)
    );
    expect(filledHelmetBack.elements.some((e) => e.text.includes('Rohan Joshi'))).toBe(true);
    expect(filledHelmetBack.elements.some((e) => e.text.includes('O+'))).toBe(true);
  });

  it('clips Dog Tag photo/logo inside inner circle behind maroon ring and exposes User Profile selector in Studio', () => {
    const dogTpl = DEFAULT_CARD_TEMPLATES.find((t) => t.templateId === 'pet-dog-tag-classic')!;
    const helmetTpl = DEFAULT_CARD_TEMPLATES.find(
      (t) => t.templateId === 'belongings-helmet-sticker-round'
    )!;
    const adultTpl = DEFAULT_CARD_TEMPLATES.find((t) => t.isDefault) || DEFAULT_CARD_TEMPLATES[0];

    const clip = resolveSideMediaClipCircle(dogTpl.frontSpec);
    expect(clip).toBeDefined();
    expect(clip?.widthPct).toBeCloseTo(30.28, 2);
    expect(clip?.heightPct).toBeCloseTo(48, 2);
    expect(clip?.borderColor).toBe('#FFFFFF');

    // Legacy saved Dog Tag drafts without explicit mediaClipCircle still clip cleanly via s-dog-f-center
    const legacyDogSide = { ...dogTpl.frontSpec, mediaClipCircle: undefined };
    expect(resolveSideMediaClipCircle(legacyDogSide)?.xPct).toBeCloseTo(34.86, 2);

    // Other templates (including round helmet sticker) do not use inner-circle media clipping
    expect(resolveSideMediaClipCircle(helmetTpl.frontSpec)).toBeUndefined();
    expect(resolveSideMediaClipCircle(adultTpl.frontSpec)).toBeUndefined();

    const studioSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/pages/customer/CustomerStudioCheckoutPages.tsx'),
      'utf8'
    );
    expect(studioSrc).toContain('studio-user-profile-select');
    expect(studioSrc).toContain('User Profile');
  });

  it('supports per-element Undo and Reset without touching sibling elements, plus full Reset Design warning', () => {
    const baseTpl = DEFAULT_CARD_TEMPLATES.find((t) => t.templateId === 'azure-tech-waves')!;
    const originalSide = structuredClone(baseTpl.frontSpec);
    const primaryEl = originalSide.elements[0];
    const siblingEl = originalSide.elements[1];
    expect(primaryEl).toBeDefined();
    expect(siblingEl).toBeDefined();

    // 1. User changes primary element color to Blue (#1D4ED8), and also customizes a sibling element and background
    const withBlue = {
      ...originalSide,
      backgroundColor: '#112233',
      elements: originalSide.elements.map((el) =>
        el.id === primaryEl.id
          ? { ...el, color: '#1D4ED8' }
          : el.id === siblingEl.id
            ? { ...el, text: 'Sibling Kept Custom', color: '#F59E0B' }
            : el
      ),
    };
    const blueSnap = extractElementSnapshot(withBlue, { kind: 'text', id: primaryEl.id })!;
    expect(blueSnap.kind).toBe('text');
    if (blueSnap.kind !== 'text') {
      throw new Error('Expected text snapshot');
    }

    // 2. User changes primary element from Blue -> Green (#10B981)
    const withGreen = applyElementSnapshot(withBlue, {
      ...blueSnap,
      element: { ...blueSnap.element, color: '#10B981' },
    });
    expect(
      withGreen.elements.find((e) => e.id === primaryEl.id)?.color
    ).toBe('#10B981');

    // 3. Undo on ONLY the primary element restores Blue while leaving sibling & background untouched
    const afterUndoToBlue = applyElementSnapshot(withGreen, blueSnap);
    expect(
      afterUndoToBlue.elements.find((e) => e.id === primaryEl.id)?.color
    ).toBe('#1D4ED8');
    expect(
      afterUndoToBlue.elements.find((e) => e.id === siblingEl.id)?.text
    ).toBe('Sibling Kept Custom');
    expect(afterUndoToBlue.backgroundColor).toBe('#112233');

    // 4. Resetting ONLY the primary element restores original template color while preserving sibling & background edits
    const greenSnapBeforeReset = extractElementSnapshot(withGreen, {
      kind: 'text',
      id: primaryEl.id,
    })!;
    const resetResult = resetSingleElementOnSide({
      currentSide: withGreen,
      originalSide,
      target: { kind: 'text', id: primaryEl.id },
    });
    expect(resetResult.changed).toBe(true);
    expect(
      resetResult.nextSide.elements.find((e) => e.id === primaryEl.id)?.color
    ).toBe(primaryEl.color);
    expect(
      resetResult.nextSide.elements.find((e) => e.id === siblingEl.id)?.text
    ).toBe('Sibling Kept Custom');
    expect(
      resetResult.nextSide.elements.find((e) => e.id === siblingEl.id)?.color
    ).toBe('#F59E0B');
    expect(resetResult.nextSide.backgroundColor).toBe('#112233');

    // 5. Undo after element Reset can still restore Green!
    const undoneReset = applyElementSnapshot(resetResult.nextSide, greenSnapBeforeReset);
    expect(
      undoneReset.elements.find((e) => e.id === primaryEl.id)?.color
    ).toBe('#10B981');
    expect(
      areElementSnapshotsEqual(
        extractElementSnapshot(undoneReset, { kind: 'text', id: primaryEl.id }),
        greenSnapBeforeReset
      )
    ).toBe(true);

    // 6. Resetting background only restores background without resetting text/QR edits
    const bgReset = resetSingleElementOnSide({
      currentSide: resetResult.nextSide,
      originalSide,
      target: { kind: 'background' },
    });
    expect(bgReset.changed).toBe(true);
    expect(bgReset.nextSide.backgroundColor).toBe(originalSide.backgroundColor);
    expect(
      bgReset.nextSide.elements.find((e) => e.id === siblingEl.id)?.text
    ).toBe('Sibling Kept Custom');

    const studioSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/pages/customer/CustomerStudioCheckoutPages.tsx'),
      'utf8'
    );
    expect(studioSrc).toContain('Reset Design');
    expect(studioSrc).toContain('reset-design-modal-title');
    expect(studioSrc).toContain('renderElementHistoryButtons');
    expect(studioSrc).toContain('Reset All Settings');
  });

  it('places Profile Type dropdown at the top bar directly before Create Digital Profile button', () => {
    const profilePagesSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/pages/customer/CustomerProfilePages.tsx'),
      'utf8'
    );
    const hubSelectIdx = profilePagesSrc.indexOf('id="hub-profile-type-select"');
    const hubCreateBtnIdx = profilePagesSrc.indexOf('<span>Create Digital Profile</span>', hubSelectIdx);
    expect(hubSelectIdx).toBeGreaterThan(-1);
    expect(hubCreateBtnIdx).toBeGreaterThan(hubSelectIdx);

    expect(profilePagesSrc).toContain('initialProfileType');
    expect(profilePagesSrc).toContain('id="empty-profile-type-select"');
  });
});


