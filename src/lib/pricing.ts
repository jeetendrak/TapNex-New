import type { CardDesignTier, CardTechnologyType, CardTemplateRecord } from '../types';

export const CARD_TIER_PRICING: Record<CardDesignTier, Record<CardTechnologyType, number>> = {
  minimal: {
    qr_only: 499,
    qr_smart: 999,
  },
  designer: {
    qr_only: 599,
    qr_smart: 1499,
  },
};

export const SPECIAL_PACK_PRICING = {
  dogTagPairInr: 599,
  dogTagPackNote: 'Pack of 2 Dog Tags · Collar belt not included',
  helmetStickerPairInr: 299,
  helmetStickerPackNote: 'Pack of 2 QR Stickers (1 for Helmet & 1 for Bike)',
} as const;

const MINIMAL_TEMPLATE_IDS = new Set([
  'azure-tech-waves',
  'minimal-white',
  'blue-gradient',
  'modern-business',
  'slate-wave-minimal',
  'blank-custom',
]);

const FIXED_PACK_TEMPLATE_CONFIG: Record<
  string,
  { priceInr: number; packNote: string; cardType: string }
> = {
  'pet-dog-tag-classic': {
    priceInr: SPECIAL_PACK_PRICING.dogTagPairInr,
    packNote: SPECIAL_PACK_PRICING.dogTagPackNote,
    cardType: 'Dog Tags (Pack of 2 · Collar Belt Not Included)',
  },
  'belongings-helmet-sticker-round': {
    priceInr: SPECIAL_PACK_PRICING.helmetStickerPairInr,
    packNote: SPECIAL_PACK_PRICING.helmetStickerPackNote,
    cardType: 'Helmet & Bike Round QR Stickers (Pack of 2)',
  },
};

export function resolveTemplateDesignTier(
  template?: Pick<CardTemplateRecord, 'templateId' | 'designTier' | 'category'> | null
): CardDesignTier {
  if (template?.designTier === 'minimal' || template?.designTier === 'designer') {
    return template.designTier;
  }
  if (template?.templateId && MINIMAL_TEMPLATE_IDS.has(template.templateId)) {
    return 'minimal';
  }
  const cat = (template?.category || '').toLowerCase();
  if (cat.includes('minimal') || cat.includes('custom upload')) {
    return 'minimal';
  }
  return 'designer';
}

export interface ResolvedCardPricing {
  unitPriceInr: number;
  designTier: CardDesignTier;
  cardTechnology: CardTechnologyType;
  pricingMode: 'card_tiers' | 'fixed_pack';
  qrOnlyPriceInr: number;
  qrSmartPriceInr: number;
  packNote?: string;
  editionLabel: string;
  cardTypeLabel: string;
}

export function resolveCardPricing(
  template?: Partial<CardTemplateRecord> | null,
  selectedTechnology: CardTechnologyType = 'qr_smart'
): ResolvedCardPricing {
  const tplId = template?.templateId || '';
  const fixedCfg = FIXED_PACK_TEMPLATE_CONFIG[tplId];

  if (template?.pricingMode === 'fixed_pack' || fixedCfg) {
    const unitPriceInr =
      typeof template?.priceInr === 'number' && template.priceInr > 0
        ? template.priceInr
        : fixedCfg?.priceInr ?? SPECIAL_PACK_PRICING.dogTagPairInr;
    const packNote = template?.packNote || fixedCfg?.packNote || 'Pack of 2 Smart Tags';
    const cardTypeLabel = fixedCfg?.cardType || template?.cardType || packNote;
    return {
      unitPriceInr,
      designTier: resolveTemplateDesignTier(template as CardTemplateRecord),
      cardTechnology: 'qr_only',
      pricingMode: 'fixed_pack',
      qrOnlyPriceInr: unitPriceInr,
      qrSmartPriceInr: unitPriceInr,
      packNote,
      editionLabel: packNote,
      cardTypeLabel,
    };
  }

  const tier = resolveTemplateDesignTier(template as CardTemplateRecord);
  const qrOnlyPriceInr = CARD_TIER_PRICING[tier].qr_only;
  const qrSmartPriceInr = CARD_TIER_PRICING[tier].qr_smart;
  const cardTechnology: CardTechnologyType = selectedTechnology === 'qr_only' ? 'qr_only' : 'qr_smart';
  const unitPriceInr = cardTechnology === 'qr_only' ? qrOnlyPriceInr : qrSmartPriceInr;
  const tierLabel = tier === 'minimal' ? 'Minimal Design' : 'Designer Card';
  const techLabel = cardTechnology === 'qr_only' ? 'QR Code Only' : 'QR + Smart Card (NFC)';

  return {
    unitPriceInr,
    designTier: tier,
    cardTechnology,
    pricingMode: 'card_tiers',
    qrOnlyPriceInr,
    qrSmartPriceInr,
    editionLabel: `${tierLabel} · ${techLabel}`,
    cardTypeLabel: `${tierLabel} — ${techLabel}`,
  };
}
