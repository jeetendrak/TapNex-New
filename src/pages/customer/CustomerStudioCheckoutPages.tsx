import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Plus,
  Trash2,
  Upload,
  Lock,
  ShieldCheck,
  Truck,
  QrCode,
  AlertCircle,
  AlertTriangle,
  Send,
  RotateCcw,
  Undo2,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Info,
  Image as ImageIcon,
  UserCircle2,
  Eye,
  Save,
  ChevronDown,
  Crop,
  Copy,
  Type,
  Wifi,
  Sparkles,
  Check,
  Layers,
  Square,
  Circle,
  Minus,
  ArrowUpToLine,
  ArrowDownToLine,
  AlignVerticalJustifyCenter,
  Palette,
  Star,
  X,
} from 'lucide-react';
import { PortalLayout } from '../../components/PortalLayout';
import { CardCanvasPreview, type CardCanvasTarget } from '../../components/CardCanvasPreview';
import { CardDesignPreviewModal } from '../../components/CardDesignPreviewModal';
import { ColorPaletteField } from '../../components/ColorPaletteField';
import { FulfilmentTimeline } from '../../components/FulfilmentTimeline';
import {
  alignTargetsOnSide,
  applyElementSnapshot,
  areElementSnapshotsEqual,
  computeSnapAndGuidelines,
  extractElementSnapshot,
  getElementHistoryKey,
  isSameTarget,
  mmToTrimHeightPct,
  mmToTrimWidthPct,
  nudgeTargetsOnSide,
  resetSingleElementOnSide,
  resolveSideMediaClipCircle,
  type AlignAction,
  type CardElementSnapshot,
  type ElementHistoryTarget,
} from '../../lib/cardLayout';
import {
  ProfilePhotoEditorModal,
  autoFitImageToSquareDataUrl,
  readImageFileAsDataUrl,
} from '../../components/ProfilePhotoEditorModal';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  createPendingOrder,
  createSupportTicket,
  extractTimestampMs,
  getCardDesignById,
  getCardTemplates,
  getCustomerOrders,
  getOrderById,
  getQrCodeById,
  getSupportTickets,
  getUserDesigns,
  getUserProfiles,
  sanitizeSlug,
  saveCardDesign,
  sendAndLogTransactionalEmail,
} from '../../lib/firestoreService';
import {
  createPaymentOrder,
  generatePurchasedQr,
  verifyPayment,
} from '../../lib/paymentApi';
import { getActiveStudioDraft, saveActiveStudioDraft } from '../../lib/studioDraft';
import { formatFirestoreErrorMessage } from '../../lib/cardDesignSize';
import { formatEmailDeliveryFailureReason } from '../../lib/dispatchEmailFeedback';
import { compressImageFileToDataUrl } from '../../lib/qrArtwork';
import { resolveCardTokens } from '../../lib/printPdf';
import { resolveCardPricing } from '../../lib/pricing';
import {
  buildEffectiveProfileInfo,
  detectFieldKeyFromText,
  doesSideContainField,
  getNextCleanCardTextSlot,
  populateSideWithProfileInfo,
  refreshUneditedSideWithProfileInfo,
  selectDefaultTemplateForProfile,
} from '../../lib/cardProfileSync';
import {
  BLANK_CARD_TEMPLATE,
  DEFAULT_CARD_TEMPLATES,
  DEFAULT_PAYMENT_GATEWAYS,
  INDIAN_STATES,
  PAYMENT_GATEWAY_ORDER,
  PROFILE_TYPE_OPTIONS,
} from '../../lib/constants';
import type {
  CardDesignRecord,
  CardShapeElement,
  CardSideDesign,
  CardTechnologyType,
  CardTemplateRecord,
  CardTextElement,
  OrderRecord,
  PaymentGatewayConfig,
  ProfileRecord,
  ProfileType,
  QrCodeRecord,
  SupportTicketRecord,
} from '../../types';

const SYSTEM_FONTS = [
  { label: 'Plus Jakarta Sans (Brand)', value: 'Plus Jakarta Sans' },
  { label: 'DM Sans (Brand)', value: 'DM Sans' },
  { label: 'JetBrains Mono (Code)', value: 'JetBrains Mono' },
  { label: 'Arial (System Sans)', value: 'Arial, sans-serif' },
  { label: 'Helvetica (System Sans)', value: 'Helvetica, sans-serif' },
  { label: 'Verdana (System Sans)', value: 'Verdana, sans-serif' },
  { label: 'Tahoma (System Sans)', value: 'Tahoma, sans-serif' },
  { label: 'Trebuchet MS (System Sans)', value: 'Trebuchet MS, sans-serif' },
  { label: 'Impact (Display Sans)', value: 'Impact, sans-serif' },
  { label: 'Georgia (System Serif)', value: 'Georgia, serif' },
  { label: 'Times New Roman (System Serif)', value: 'Times New Roman, serif' },
  { label: 'Courier New (System Mono)', value: 'Courier New, monospace' },
];

function cloneSide(side: CardSideDesign): CardSideDesign {
  return JSON.parse(JSON.stringify(side)) as CardSideDesign;
}

function isLightHexColor(hex: string): boolean {
  const cleaned = hex.replace('#', '').trim();
  if (cleaned.length !== 6 && cleaned.length !== 3) return false;
  const full =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map((c) => c + c)
          .join('')
      : cleaned;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return false;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62;
}

interface ProfileCardFieldOption {
  key: string;
  label: string;
  previewValue: string;
  insertText: string;
  defaultFontSizePt: number;
  defaultBold?: boolean;
}

const DEFAULT_STARTER_TEMPLATE =
  DEFAULT_CARD_TEMPLATES.find((t) => t.isDefault) || DEFAULT_CARD_TEMPLATES[0];

// 6. Business Card Design Studio (85.6 x 54 mm + Non-Scannable QR Placeholder)
export const CustomerCardStudioPage: React.FC = () => {
  const { userRecord } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();

  const [templates, setTemplates] = useState<CardTemplateRecord[]>(DEFAULT_CARD_TEMPLATES);
  const [templateProfileFilter, setTemplateProfileFilter] = useState<'recommended' | 'all' | ProfileType>('recommended');
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<ProfileRecord | null>(null);
  const [mode, setMode] = useState<'default' | 'custom'>('default');
  const [customizeTab, setCustomizeTab] = useState<'text' | 'shapes' | 'background' | 'media' | 'qr'>('text');
  const [selectedTpl, setSelectedTpl] = useState<CardTemplateRecord>(DEFAULT_STARTER_TEMPLATE);
  const [cardTechnology, setCardTechnology] = useState<CardTechnologyType>('qr_smart');
  const [activeSide, setActiveSide] = useState<'front' | 'back'>('front');
  const [orientation, setOrientation] = useState<'landscape' | 'vertical'>('landscape');
  const [frontDesign, setFrontDesign] = useState<CardSideDesign>(() => cloneSide(DEFAULT_STARTER_TEMPLATE.frontSpec));
  const [backDesign, setBackDesign] = useState<CardSideDesign>(() => cloneSide(DEFAULT_STARTER_TEMPLATE.backSpec));
  const [selectedTargets, setSelectedTargets] = useState<CardCanvasTarget[]>([]);
  const [guidelines, setGuidelines] = useState<{ vertical: number[]; horizontal: number[] }>({
    vertical: [],
    horizontal: [],
  });
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [fieldsDropdownOpen, setFieldsDropdownOpen] = useState(false);
  const [photoCropSource, setPhotoCropSource] = useState<string | null>(null);
  const [approvalChecked, setApprovalChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedDesigns, setSavedDesigns] = useState<CardDesignRecord[]>([]);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [resetDesignModalOpen, setResetDesignModalOpen] = useState(false);
  const [historyRev, setHistoryRev] = useState(0);
  const studioReadyRef = useRef(false);
  const fieldsDropdownRef = useRef<HTMLDivElement | null>(null);
  const elementHistoryRef = useRef<Record<string, CardElementSnapshot[]>>({});
  const customInitialSnapshotsRef = useRef<Record<string, CardElementSnapshot>>({});
  const lastGestureRef = useRef<{ key: string; ts: number } | null>(null);
  const hiddenProfileElementsRef = useRef<{
    front: { elements: CardTextElement[]; showAvatar: boolean };
    back: { elements: CardTextElement[]; showAvatar: boolean };
  }>({
    front: { elements: [], showAvatar: false },
    back: { elements: [], showAvatar: false },
  });

  const selectedTarget = selectedTargets[0] || null;
  const setSelectedTarget = (t: CardCanvasTarget | null) => {
    setSelectedTargets(t ? [t] : []);
  };
  const selectedElementId = selectedTarget?.kind === 'text' ? selectedTarget.id : null;
  const selectedShapeId = selectedTarget?.kind === 'shape' ? selectedTarget.id : null;

  useEffect(() => {
    if (!fieldsDropdownOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (fieldsDropdownRef.current && !fieldsDropdownRef.current.contains(e.target as Node)) {
        setFieldsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [fieldsDropdownOpen]);

  const hydrateDesignForProfile = (
    prof: ProfileRecord | null,
    activeList: CardTemplateRecord[],
    userDesigns: CardDesignRecord[],
    uid: string,
    usr = userRecord
  ) => {
    const effInfo = buildEffectiveProfileInfo(prof, usr);
    const localDraft = prof ? getActiveStudioDraft(uid, prof.profileId) : null;
    const matchingSaved = prof
      ? userDesigns.find((d) => d.profileId === prof.profileId)
      : !localDraft
        ? userDesigns[0]
        : undefined;
    const savedMs = matchingSaved
      ? extractTimestampMs(matchingSaved.updatedAt) || extractTimestampMs(matchingSaved.createdAt)
      : 0;

    const defaultFallback: CardTemplateRecord =
      selectDefaultTemplateForProfile(prof, activeList) || DEFAULT_CARD_TEMPLATES[0] || BLANK_CARD_TEMPLATE;

    const isRetiredTemplate = (tplId?: string) => tplId === 'belongings-helmet-accident-sos';
    const validLocalDraft = localDraft && !isRetiredTemplate(localDraft.templateId) ? localDraft : null;
    const validSaved = matchingSaved && !isRetiredTemplate(matchingSaved.templateId) ? matchingSaved : undefined;

    if (validLocalDraft && (!validSaved || validLocalDraft.updatedMs >= savedMs)) {
      const matchedTpl =
        activeList.find((t) => t.templateId === validLocalDraft.templateId) ||
        (validLocalDraft.templateId === BLANK_CARD_TEMPLATE.templateId ? BLANK_CARD_TEMPLATE : defaultFallback);
      setSelectedTpl(matchedTpl);
      const inferredTech: CardTechnologyType =
        validLocalDraft.cardTechnology || (validLocalDraft.frontDesign.showNfcIcon ? 'qr_smart' : 'qr_only');
      setCardTechnology(inferredTech);
      setOrientation(validLocalDraft.cardOrientation || 'landscape');
      const hydratedFrontRaw = refreshUneditedSideWithProfileInfo(validLocalDraft.frontDesign, effInfo);
      const hydratedFront =
        matchedTpl.frontSpec.mediaClipCircle && !hydratedFrontRaw.mediaClipCircle
          ? { ...hydratedFrontRaw, mediaClipCircle: matchedTpl.frontSpec.mediaClipCircle }
          : hydratedFrontRaw;
      const hydratedBack = refreshUneditedSideWithProfileInfo(validLocalDraft.backDesign, effInfo);
      setFrontDesign(hydratedFront);
      setBackDesign(hydratedBack);
      setMode('custom');
      setSelectedTarget(hydratedFront.elements[0] ? { kind: 'text', id: hydratedFront.elements[0].id } : null);
    } else if (validSaved) {
      const matchedTpl =
        activeList.find((t) => t.templateId === validSaved.templateId) ||
        (validSaved.templateId === BLANK_CARD_TEMPLATE.templateId ? BLANK_CARD_TEMPLATE : defaultFallback);
      setSelectedTpl(matchedTpl);
      const inferredTech: CardTechnologyType =
        validSaved.cardTechnology || (validSaved.frontDesign.showNfcIcon ? 'qr_smart' : 'qr_only');
      setCardTechnology(inferredTech);
      setOrientation(validSaved.cardOrientation || 'landscape');
      const hydratedFrontRaw = refreshUneditedSideWithProfileInfo(validSaved.frontDesign, effInfo);
      const hydratedFront =
        matchedTpl.frontSpec.mediaClipCircle && !hydratedFrontRaw.mediaClipCircle
          ? { ...hydratedFrontRaw, mediaClipCircle: matchedTpl.frontSpec.mediaClipCircle }
          : hydratedFrontRaw;
      const hydratedBack = refreshUneditedSideWithProfileInfo(validSaved.backDesign, effInfo);
      setFrontDesign(hydratedFront);
      setBackDesign(hydratedBack);
      setMode('custom');
      setSelectedTarget(hydratedFront.elements[0] ? { kind: 'text', id: hydratedFront.elements[0].id } : null);
    } else {
      const firstTpl = defaultFallback;
      setSelectedTpl(firstTpl);
      setCardTechnology(firstTpl.frontSpec.showNfcIcon ? 'qr_smart' : 'qr_only');
      const initialFront = populateSideWithProfileInfo(firstTpl.frontSpec, effInfo);
      const initialBack = populateSideWithProfileInfo(firstTpl.backSpec, effInfo);
      setFrontDesign(initialFront);
      setBackDesign(initialBack);
      setSelectedTarget(null);
    }
    elementHistoryRef.current = {};
    customInitialSnapshotsRef.current = {};
    lastGestureRef.current = null;
    setHistoryRev((r) => r + 1);
  };

  useEffect(() => {
    if (!userRecord) return;
    studioReadyRef.current = false;
    Promise.all([getCardTemplates(), getUserProfiles(userRecord.uid), getUserDesigns(userRecord.uid)]).then(
      ([tpls, profs, userDesigns]) => {
        const activeList = tpls;
        setTemplates(activeList);
        const preferredProfileId = localStorage.getItem(`tapnex_active_profile_${userRecord.uid}`);
        const firstProf = profs.find((p) => p.profileId === preferredProfileId) || profs[0] || null;
        setProfiles(profs);
        setSelectedProfile(firstProf);
        setSavedDesigns(userDesigns);

        hydrateDesignForProfile(firstProf, activeList, userDesigns, userRecord.uid, userRecord);
        setTimeout(() => {
          studioReadyRef.current = true;
        }, 0);
      }
    );
  }, [userRecord]);

  // Persist current Studio design (whether template-selected or customized) so Preview matches Studio identically
  useEffect(() => {
    if (!studioReadyRef.current || !userRecord || !selectedProfile) return;
    saveActiveStudioDraft(userRecord.uid, selectedProfile.profileId, {
      templateId: selectedTpl.templateId,
      templateName: selectedTpl.name,
      cardTechnology,
      cardOrientation: orientation,
      frontDesign,
      backDesign,
    });
  }, [userRecord, selectedProfile, selectedTpl, cardTechnology, orientation, frontDesign, backDesign]);

  // Automatically fetch user photo when profile switcher changes (unless custom uploaded or avatar hidden)
  useEffect(() => {
    const profilePhoto = selectedProfile?.personalInformation?.photoDataUrl;
    if (!profilePhoto) return;
    setFrontDesign((prev) => {
      if (!prev.showAvatar && !prev.avatarDataUrl) return prev;
      return {
        ...prev,
        avatarDataUrl: prev.avatarDataUrl || profilePhoto,
        avatarSizeMm: prev.avatarSizeMm || 15,
      };
    });
  }, [selectedProfile]);

  const activeStudioProfileType: ProfileType = selectedProfile?.profileType || 'adult';
  const filteredTemplatesByType = templates.filter((t) => {
    if (t.templateId === BLANK_CARD_TEMPLATE.templateId) return false;
    if (templateProfileFilter === 'all') return true;
    if (templateProfileFilter === 'recommended') {
      return !t.profileType || t.profileType === 'all' || t.profileType === activeStudioProfileType;
    }
    return t.profileType === templateProfileFilter || t.profileType === 'all';
  });

  const allDropdownTemplates: CardTemplateRecord[] = [
    ...filteredTemplatesByType,
    BLANK_CARD_TEMPLATE,
  ];

  const effectiveProfileInfo = buildEffectiveProfileInfo(selectedProfile, userRecord);
  const recommendedTemplateForProfile = selectDefaultTemplateForProfile(selectedProfile, templates);
  const studioPricing = resolveCardPricing(selectedTpl, cardTechnology);

  const handleSelectTechnology = (nextTech: CardTechnologyType) => {
    setCardTechnology(nextTech);
    if (selectedTpl.pricingMode !== 'fixed_pack') {
      pushElementUndo('front', { kind: 'nfc' }, frontDesign, false);
      setFrontDesign((prev) => ({
        ...prev,
        showNfcIcon: nextTech === 'qr_smart',
      }));
    }
  };

  const clearAllElementHistory = () => {
    elementHistoryRef.current = {};
    customInitialSnapshotsRef.current = {};
    lastGestureRef.current = null;
    setHistoryRev((r) => r + 1);
  };

  const applyTemplate = (tpl: CardTemplateRecord, enterCustomMode = false) => {
    setSelectedTpl(tpl);
    const nextFrontRaw = populateSideWithProfileInfo(tpl.frontSpec, effectiveProfileInfo);
    const nextFront: CardSideDesign =
      tpl.pricingMode === 'fixed_pack'
        ? nextFrontRaw
        : {
            ...nextFrontRaw,
            showNfcIcon: cardTechnology === 'qr_smart',
          };
    const nextBack = populateSideWithProfileInfo(tpl.backSpec, effectiveProfileInfo);
    setFrontDesign(nextFront);
    setBackDesign(nextBack);
    if (tpl.pricingMode === 'fixed_pack') {
      setCardTechnology('qr_only');
    }
    if (!tpl.supportsVertical && orientation === 'vertical') {
      setOrientation('landscape');
    }
    if (enterCustomMode) {
      setMode('custom');
    }
    const activeElements = activeSide === 'front' ? nextFront.elements : nextBack.elements;
    setSelectedTarget(
      (enterCustomMode || mode === 'custom') && activeElements[0]
        ? { kind: 'text', id: activeElements[0].id }
        : null
    );
    setEditingTextId(null);
    clearAllElementHistory();
  };

  const handleLoadDefaultSettings = () => {
    const defaultFallback = templates.find((t) => t.isDefault) || templates[0] || BLANK_CARD_TEMPLATE;
    const baseTpl =
      templates.find((t) => t.templateId === selectedTpl.templateId) ||
      DEFAULT_CARD_TEMPLATES.find((t) => t.templateId === selectedTpl.templateId) ||
      (selectedTpl.templateId === BLANK_CARD_TEMPLATE.templateId ? BLANK_CARD_TEMPLATE : null) ||
      defaultFallback;
    const nextFront = populateSideWithProfileInfo(baseTpl.frontSpec, effectiveProfileInfo);
    const nextBack = populateSideWithProfileInfo(baseTpl.backSpec, effectiveProfileInfo);
    setFrontDesign(nextFront);
    setBackDesign(nextBack);
    setOrientation('landscape');
    setActiveSide('front');
    setSelectedTarget(null);
    setEditingTextId(null);
    setApprovalChecked(false);
    clearAllElementHistory();
    setResetDesignModalOpen(false);
    notify('Entire design reset', `All settings reset to ${baseTpl.name} template defaults.`, 'info');
  };

  const currentSide = activeSide === 'front' ? frontDesign : backDesign;
  const setCurrentSide = (updated: CardSideDesign) => {
    if (activeSide === 'front') setFrontDesign(updated);
    else setBackDesign(updated);
  };

  const getSideByName = (sideName: 'front' | 'back') => (sideName === 'front' ? frontDesign : backDesign);

  const pushElementUndo = (
    sideName: 'front' | 'back',
    target: ElementHistoryTarget,
    sideSnapshotSource?: CardSideDesign,
    continuous = false
  ) => {
    const key = getElementHistoryKey(sideName, target);
    const source = sideSnapshotSource ?? getSideByName(sideName);
    const snap = extractElementSnapshot(source, target);
    if (!snap) return;

    if (continuous) {
      const now = Date.now();
      if (lastGestureRef.current && lastGestureRef.current.key === key && now - lastGestureRef.current.ts < 900) {
        lastGestureRef.current.ts = now;
        return;
      }
      lastGestureRef.current = { key, ts: now };
    } else {
      lastGestureRef.current = null;
    }

    const existing = elementHistoryRef.current[key] || [];
    if (existing.length > 0 && areElementSnapshotsEqual(existing[existing.length - 1], snap)) {
      return;
    }
    elementHistoryRef.current[key] = [...existing.slice(-39), snap];
    setHistoryRev((r) => r + 1);
  };

  const canUndoElement = (sideName: 'front' | 'back', target: ElementHistoryTarget): boolean => {
    void historyRev;
    const key = getElementHistoryKey(sideName, target);
    return (elementHistoryRef.current[key]?.length || 0) > 0;
  };

  const undoElementChange = (sideName: 'front' | 'back', target: ElementHistoryTarget, label?: string) => {
    const key = getElementHistoryKey(sideName, target);
    const stack = elementHistoryRef.current[key];
    if (!stack || stack.length === 0) return;
    const previousSnap = stack[stack.length - 1];
    elementHistoryRef.current[key] = stack.slice(0, -1);
    lastGestureRef.current = null;
    if (sideName === 'front') {
      setFrontDesign((prev) => applyElementSnapshot(prev, previousSnap));
    } else {
      setBackDesign((prev) => applyElementSnapshot(prev, previousSnap));
    }
    setHistoryRev((r) => r + 1);
    if (label) {
      notify('Undid change', `Reverted last change to ${label}.`, 'info');
    }
  };

  const getOriginalTemplateSide = (sideName: 'front' | 'back'): CardSideDesign => {
    const defaultFallback = templates.find((t) => t.isDefault) || templates[0] || BLANK_CARD_TEMPLATE;
    const baseTpl =
      templates.find((t) => t.templateId === selectedTpl.templateId) ||
      DEFAULT_CARD_TEMPLATES.find((t) => t.templateId === selectedTpl.templateId) ||
      (selectedTpl.templateId === BLANK_CARD_TEMPLATE.templateId ? BLANK_CARD_TEMPLATE : null) ||
      defaultFallback;
    const rawSide = sideName === 'front' ? baseTpl.frontSpec : baseTpl.backSpec;
    return populateSideWithProfileInfo(rawSide, effectiveProfileInfo);
  };

  const resetSingleElement = (sideName: 'front' | 'back', target: ElementHistoryTarget, label?: string) => {
    const current = getSideByName(sideName);
    const original = getOriginalTemplateSide(sideName);
    const key = getElementHistoryKey(sideName, target);
    const { nextSide, changed } = resetSingleElementOnSide({
      currentSide: current,
      originalSide: original,
      target,
      fallbackSnapshot: customInitialSnapshotsRef.current[key] || null,
    });
    if (!changed) {
      notify('Already at original', `${label || 'This element'} matches its original setting.`, 'info');
      return;
    }
    pushElementUndo(sideName, target, current, false);
    if (sideName === 'front') setFrontDesign(nextSide);
    else setBackDesign(nextSide);
    lastGestureRef.current = null;
    notify(
      'Element reset to original',
      `Reset ${label || 'selected element'} only — click Undo on this element to restore your previous change.`,
      'success'
    );
  };

  const renderElementHistoryButtons = (
    sideName: 'front' | 'back',
    target: ElementHistoryTarget,
    label: string,
    compact = false
  ) => {
    const undoAvailable = canUndoElement(sideName, target);
    const btnPad = compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1 text-[11px]';
    return (
      <>
        <button
          type="button"
          disabled={!undoAvailable}
          onClick={() => undoElementChange(sideName, target, label)}
          title={`Undo last change to ${label}`}
          className={`inline-flex items-center gap-1 ${btnPad} rounded-md border font-semibold transition-colors ${
            undoAvailable
              ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
              : 'border-[#E9E4F5] bg-white text-slate-400 cursor-not-allowed opacity-60'
          }`}
        >
          <Undo2 className="h-3 w-3" />
          <span>Undo</span>
        </button>
        <button
          type="button"
          onClick={() => resetSingleElement(sideName, target, label)}
          title={`Reset only ${label} to original color & style`}
          className={`inline-flex items-center gap-1 ${btnPad} rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 font-semibold transition-colors`}
        >
          <RotateCcw className="h-3 w-3" />
          <span>Reset</span>
        </button>
      </>
    );
  };

  const updateAvatarSide = (patch: Partial<CardSideDesign>, continuous = false) => {
    pushElementUndo(activeSide, { kind: 'avatar' }, currentSide, continuous);
    setCurrentSide({ ...currentSide, ...patch });
  };

  const updateLogoSide = (patch: Partial<CardSideDesign>, continuous = false) => {
    pushElementUndo(activeSide, { kind: 'logo' }, currentSide, continuous);
    setCurrentSide({ ...currentSide, ...patch });
  };

  const updateQrSide = (patch: Partial<CardSideDesign>, continuous = false) => {
    pushElementUndo(activeSide, { kind: 'qr' }, currentSide, continuous);
    setCurrentSide({ ...currentSide, ...patch });
  };

  const updateNfcSide = (patch: Partial<CardSideDesign>, continuous = false) => {
    pushElementUndo(activeSide, { kind: 'nfc' }, currentSide, continuous);
    setCurrentSide({ ...currentSide, ...patch });
  };

  const updateBackgroundForSide = (
    targetSide: 'front' | 'back',
    patch: Partial<CardSideDesign>,
    continuous = false
  ) => {
    const sourceSide = getSideByName(targetSide);
    pushElementUndo(targetSide, { kind: 'background' }, sourceSide, continuous);
    if (targetSide === 'front') {
      setFrontDesign((prev) => ({ ...prev, ...patch }));
    } else {
      setBackDesign((prev) => ({ ...prev, ...patch }));
    }
  };

  const resizeAvatarSizeMm = (nextMm: number) => {
    pushElementUndo(activeSide, { kind: 'avatar' }, currentSide, true);
    if (!resolveSideMediaClipCircle(currentSide)) {
      setCurrentSide({ ...currentSide, avatarSizeMm: nextMm });
      return;
    }
    const oldMm = currentSide.avatarSizeMm || 13;
    const oldW = mmToTrimWidthPct(oldMm, orientation);
    const oldH = mmToTrimHeightPct(oldMm, orientation);
    const newW = mmToTrimWidthPct(nextMm, orientation);
    const newH = mmToTrimHeightPct(nextMm, orientation);
    setCurrentSide({
      ...currentSide,
      avatarSizeMm: nextMm,
      avatarX: Number((currentSide.avatarX + (oldW - newW) / 2).toFixed(2)),
      avatarY: Number((currentSide.avatarY + (oldH - newH) / 2).toFixed(2)),
    });
  };

  const resizeLogoWidthMm = (nextMm: number) => {
    pushElementUndo(activeSide, { kind: 'logo' }, currentSide, true);
    if (!resolveSideMediaClipCircle(currentSide)) {
      setCurrentSide({ ...currentSide, logoWidthMm: nextMm });
      return;
    }
    const oldMm = currentSide.logoWidthMm || 14;
    const oldW = mmToTrimWidthPct(oldMm, orientation);
    const oldH = mmToTrimHeightPct(oldMm, orientation);
    const newW = mmToTrimWidthPct(nextMm, orientation);
    const newH = mmToTrimHeightPct(nextMm, orientation);
    setCurrentSide({
      ...currentSide,
      logoWidthMm: nextMm,
      logoX: Number((currentSide.logoX + (oldW - newW) / 2).toFixed(2)),
      logoY: Number((currentSide.logoY + (oldH - newH) / 2).toFixed(2)),
    });
  };

  const selectedEl = currentSide.elements.find((e) => e.id === selectedElementId) || null;
  const selectedShape = (currentSide.shapes || []).find((s) => s.id === selectedShapeId) || null;

  const updateElementTextById = (id: string, nextText: string) => {
    pushElementUndo(activeSide, { kind: 'text', id }, currentSide, true);
    const updater = (side: CardSideDesign): CardSideDesign => ({
      ...side,
      elements: side.elements.map((el) => (el.id === id ? { ...el, text: nextText } : el)),
    });
    if (activeSide === 'front') setFrontDesign(updater);
    else setBackDesign(updater);
  };

  const updateSelectedEl = (patch: Partial<CardTextElement>, continuous = false) => {
    if (!selectedEl) return;
    pushElementUndo(activeSide, { kind: 'text', id: selectedEl.id }, currentSide, continuous);
    setCurrentSide({
      ...currentSide,
      elements: currentSide.elements.map((el) => (el.id === selectedEl.id ? { ...el, ...patch } : el)),
    });
  };

  const updateSelectedShape = (patch: Partial<CardShapeElement>, continuous = false) => {
    if (!selectedShape) return;
    pushElementUndo(activeSide, { kind: 'shape', id: selectedShape.id }, currentSide, continuous);
    setCurrentSide({
      ...currentSide,
      shapes: (currentSide.shapes || []).map((s) => (s.id === selectedShape.id ? { ...s, ...patch } : s)),
    });
  };

  const addShapeElement = (kind: CardShapeElement['kind']) => {
    const id = `shp_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    const defaultAccent = isLightHexColor(currentSide.backgroundColor) ? '#0B1D3A' : '#D4AF37';
    const newShape: CardShapeElement =
      kind === 'line'
        ? { id, kind: 'line', xPct: 8, yPct: 50, widthPct: 40, heightPct: 1.5, color: defaultAccent }
        : kind === 'circle'
        ? { id, kind: 'circle', xPct: 36, yPct: 24, widthPct: 24, heightPct: 38, color: defaultAccent, opacity: 0.9 }
        : kind === 'pill'
        ? { id, kind: 'pill', xPct: 12, yPct: 72, widthPct: 36, heightPct: 11, color: defaultAccent }
        : kind === 'star'
        ? { id, kind: 'star', xPct: 22, yPct: 42, widthPct: 7, heightPct: 11, color: '#DE0404' }
        : { id, kind: 'rect', xPct: 0, yPct: 78, widthPct: 100, heightPct: 14, color: defaultAccent, borderRadiusPx: 0 };
    customInitialSnapshotsRef.current[getElementHistoryKey(activeSide, { kind: 'shape', id })] = {
      kind: 'shape',
      id,
      shape: { ...newShape },
    };
    setCurrentSide({
      ...currentSide,
      shapes: [...(currentSide.shapes || []), newShape],
    });
    setSelectedTarget({ kind: 'shape', id });
    setMode('custom');
    setCustomizeTab('shapes');
  };

  const duplicateSelectedShape = () => {
    if (!selectedShape) return;
    const id = `shp_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    const copy: CardShapeElement = {
      ...selectedShape,
      id,
      xPct: Math.min(82, selectedShape.xPct + 4),
      yPct: Math.min(82, selectedShape.yPct + 6),
    };
    customInitialSnapshotsRef.current[getElementHistoryKey(activeSide, { kind: 'shape', id })] = {
      kind: 'shape',
      id,
      shape: { ...copy },
    };
    setCurrentSide({ ...currentSide, shapes: [...(currentSide.shapes || []), copy] });
    setSelectedTarget({ kind: 'shape', id });
  };

  const removeShapeById = (id: string) => {
    setCurrentSide({
      ...currentSide,
      shapes: (currentSide.shapes || []).filter((s) => s.id !== id),
    });
    if (selectedShapeId === id) setSelectedTarget(null);
  };

  const handleSelectTarget = (t: CardCanvasTarget | null, additive = false) => {
    if (!t) {
      setSelectedTargets([]);
      setEditingTextId(null);
      return;
    }
    setMode('custom');
    if (additive) {
      setSelectedTargets((prev) => {
        const exists = prev.some((p) => isSameTarget(p, t));
        return exists ? prev.filter((p) => !isSameTarget(p, t)) : [...prev, t];
      });
    } else {
      setSelectedTargets([t]);
    }
    if (t.kind === 'text') setCustomizeTab('text');
    else if (t.kind === 'shape') setCustomizeTab('shapes');
    else if (t.kind === 'avatar' || t.kind === 'logo') setCustomizeTab('media');
    else if (t.kind === 'qr' || t.kind === 'nfc') setCustomizeTab('qr');
  };

  const handleCanvasMove = (target: CardCanvasTarget, rawX: number, rawY: number) => {
    pushElementUndo(activeSide, target, currentSide, true);
    const snap = computeSnapAndGuidelines({
      side: currentSide,
      movingTarget: target,
      candidateX: rawX,
      candidateY: rawY,
      orientation,
    });
    const xPct = snap.snappedX;
    const yPct = snap.snappedY;
    setGuidelines({ vertical: snap.verticalGuides, horizontal: snap.horizontalGuides });

    if (target.kind === 'text') {
      setCurrentSide({
        ...currentSide,
        elements: currentSide.elements.map((el) => (el.id === target.id ? { ...el, xPct, yPct } : el)),
      });
    } else if (target.kind === 'shape') {
      setCurrentSide({
        ...currentSide,
        shapes: (currentSide.shapes || []).map((s) => (s.id === target.id ? { ...s, xPct, yPct } : s)),
      });
    } else if (target.kind === 'logo') {
      setCurrentSide({ ...currentSide, logoX: xPct, logoY: yPct });
    } else if (target.kind === 'avatar') {
      setCurrentSide({ ...currentSide, avatarX: xPct, avatarY: yPct });
    } else if (target.kind === 'qr') {
      setCurrentSide({ ...currentSide, qrSlotX: xPct, qrSlotY: yPct });
    } else if (target.kind === 'nfc') {
      setCurrentSide({ ...currentSide, nfcX: xPct, nfcY: yPct });
    }
  };

  // Keyboard arrow key movement (normal = 1%, Ctrl/Cmd = 1 point / 0.25% precision nudge)
  useEffect(() => {
    if (mode !== 'custom' || selectedTargets.length === 0 || editingTextId || previewModalOpen || photoCropSource) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      const targetEl = e.target as HTMLElement | null;
      if (
        targetEl &&
        (targetEl.tagName === 'INPUT' ||
          targetEl.tagName === 'TEXTAREA' ||
          targetEl.tagName === 'SELECT' ||
          targetEl.isContentEditable)
      ) {
        return;
      }
      const step = e.ctrlKey || e.metaKey ? 0.25 : 1;
      let dx = 0;
      let dy = 0;
      if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step;
      else if (e.key === 'ArrowDown') dy = step;
      else return;

      e.preventDefault();
      const sideSnapshot = activeSide === 'front' ? frontDesign : backDesign;
      selectedTargets.forEach((t) => pushElementUndo(activeSide, t, sideSnapshot, true));
      if (activeSide === 'front') {
        setFrontDesign((prev) => nudgeTargetsOnSide(prev, selectedTargets, dx, dy));
      } else {
        setBackDesign((prev) => nudgeTargetsOnSide(prev, selectedTargets, dx, dy));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode, selectedTargets, editingTextId, previewModalOpen, photoCropSource, activeSide, frontDesign, backDesign]);

  const handleAlignSelected = (action: AlignAction) => {
    if (selectedTargets.length === 0) return;
    selectedTargets.forEach((t) => pushElementUndo(activeSide, t, currentSide, false));
    setCurrentSide(alignTargetsOnSide(currentSide, selectedTargets, action, orientation));
  };

  const handleStartBlankCard = () => {
    const blankFront = populateSideWithProfileInfo(BLANK_CARD_TEMPLATE.frontSpec, effectiveProfileInfo);
    const blankBack = populateSideWithProfileInfo(BLANK_CARD_TEMPLATE.backSpec, effectiveProfileInfo);
    setSelectedTpl(BLANK_CARD_TEMPLATE);
    setFrontDesign(blankFront);
    setBackDesign(blankBack);
    setActiveSide('front');
    setMode('custom');
    setCustomizeTab('background');
    setSelectedTarget(null);
    setEditingTextId(null);
    clearAllElementHistory();
    notify(
      'Blank card canvas ready',
      'Upload separate Front & Back designs or toggle profile details below to place on your card.',
      'success'
    );
  };

  const handleSideDesignUpload = async (targetSide: 'front' | 'back', e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      notify('Image too large', 'Please upload a PNG/JPG under 5 MB.', 'error');
      return;
    }
    try {
      const dataUrl = await compressImageFileToDataUrl(file, {
        maxWidth: orientation === 'vertical' ? 709 : 1082,
        maxHeight: orientation === 'vertical' ? 1082 : 709,
        maxChars: 280_000,
      });
      updateBackgroundForSide(targetSide, { backgroundImageUrl: dataUrl }, false);
      setActiveSide(targetSide);
      setMode('custom');
      setCustomizeTab('background');
      setSelectedTarget(null);
      setEditingTextId(null);
      notify(
        `${targetSide === 'front' ? 'Front' : 'Back'} card design uploaded`,
        `Applied to ${targetSide} side only. All text, shapes, logo, photo, SMART & QR elements remain editable.`,
        'success'
      );
    } catch {
      notify('Upload failed', 'Could not read template image file.', 'error');
    }
  };

  const getDefaultContrastColor = () => (isLightHexColor(currentSide.backgroundColor) ? '#0B1D3A' : '#FFFFFF');

  const addTextElement = (initialText = 'Double-click to edit', startInlineEdit = true) => {
    const id = `txt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const slot = getNextCleanCardTextSlot(currentSide);
    const newEl: CardTextElement = {
      id,
      text: initialText,
      xPct: slot.xPct,
      yPct: slot.yPct,
      maxWidthPct: slot.maxWidthPct,
      fontSizePt: 9,
      fontFamily: 'Plus Jakarta Sans',
      fontWeight: 'normal',
      fontStyle: 'normal',
      textDecoration: 'none',
      color: getDefaultContrastColor(),
      align: 'left',
    };
    customInitialSnapshotsRef.current[getElementHistoryKey(activeSide, { kind: 'text', id })] = {
      kind: 'text',
      id,
      element: { ...newEl },
    };
    setCurrentSide({ ...currentSide, elements: [...currentSide.elements, newEl] });
    setSelectedTarget({ kind: 'text', id });
    setMode('custom');
    setCustomizeTab('text');
    if (startInlineEdit) {
      setTimeout(() => setEditingTextId(id), 0);
    }
  };

  const duplicateSelectedText = () => {
    if (!selectedEl) return;
    const id = `txt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const copy: CardTextElement = {
      ...selectedEl,
      id,
      xPct: Math.min(82, selectedEl.xPct + 4),
      yPct: Math.min(82, selectedEl.yPct + 7),
    };
    customInitialSnapshotsRef.current[getElementHistoryKey(activeSide, { kind: 'text', id })] = {
      kind: 'text',
      id,
      element: { ...copy },
    };
    setCurrentSide({ ...currentSide, elements: [...currentSide.elements, copy] });
    setSelectedTarget({ kind: 'text', id });
  };

  const removeElementById = (id: string) => {
    setCurrentSide({
      ...currentSide,
      elements: currentSide.elements.filter((el) => el.id !== id),
    });
    if (selectedElementId === id) setSelectedTarget(null);
    if (editingTextId === id) setEditingTextId(null);
  };

  // Build list of filled profile fields available for quick toggle into card layout (tailored by profileType)
  const pi = effectiveProfileInfo;
  const builtInFieldOptions: ProfileCardFieldOption[] =
    activeStudioProfileType === 'kids'
      ? [
          { key: 'fullName', label: "Child's Full Name", previewValue: pi?.fullName || '', insertText: '{{FULL_NAME}}', defaultFontSizePt: 13, defaultBold: true },
          { key: 'parentName', label: 'Parent / Guardian Name', previewValue: pi?.parentName || '', insertText: '{{PARENT_NAME}}', defaultFontSizePt: 9, defaultBold: true },
          { key: 'parentMobile', label: 'Parent Mobile', previewValue: pi?.parentMobile || pi?.mobile || '', insertText: '{{PARENT_MOBILE}}', defaultFontSizePt: 8.5 },
          { key: 'emergencyContactPhone', label: 'Emergency Helpline', previewValue: pi?.emergencyContactPhone || '', insertText: '{{EMERGENCY_PHONE}}', defaultFontSizePt: 8.5 },
          { key: 'schoolOrClass', label: 'School / Class', previewValue: pi?.schoolOrClass || '', insertText: '{{SCHOOL_CLASS}}', defaultFontSizePt: 8 },
          { key: 'bloodGroup', label: 'Blood Group', previewValue: pi?.bloodGroup || '', insertText: '{{BLOOD_GROUP}}', defaultFontSizePt: 8.5, defaultBold: true },
          { key: 'allergiesOrMedical', label: 'Allergies / Medical Notes', previewValue: pi?.allergiesOrMedical || '', insertText: '{{ALLERGIES}}', defaultFontSizePt: 7.5 },
          { key: 'personalAddress', label: 'Home / Pickup Address', previewValue: pi?.personalAddress || '', insertText: '{{PERSONAL_ADDRESS}}', defaultFontSizePt: 7.5 },
          { key: 'cityState', label: 'City & State', previewValue: [pi?.city, pi?.state].filter(Boolean).join(', '), insertText: '{{CITY_STATE}}', defaultFontSizePt: 8 },
          { key: 'shortBio', label: 'Safety / Pickup Note', previewValue: pi?.shortBio || '', insertText: '{{SHORT_BIO}}', defaultFontSizePt: 7.5 },
        ]
      : activeStudioProfileType === 'pets'
        ? [
            { key: 'fullName', label: 'Pet Name', previewValue: pi?.fullName || '', insertText: '{{FULL_NAME}}', defaultFontSizePt: 13, defaultBold: true },
            { key: 'petType', label: 'Pet Type', previewValue: pi?.petType || '', insertText: '{{PET_TYPE}}', defaultFontSizePt: 9 },
            { key: 'breed', label: 'Breed', previewValue: pi?.breed || '', insertText: '{{BREED}}', defaultFontSizePt: 8.5 },
            { key: 'microchipId', label: 'Microchip / Tag ID', previewValue: pi?.microchipId || '', insertText: '{{MICROCHIP_ID}}', defaultFontSizePt: 8 },
            { key: 'ownerName', label: 'Owner Name', previewValue: pi?.ownerName || '', insertText: '{{OWNER_NAME}}', defaultFontSizePt: 9, defaultBold: true },
            { key: 'ownerMobile', label: 'Owner Mobile', previewValue: pi?.ownerMobile || pi?.mobile || '', insertText: '{{OWNER_MOBILE}}', defaultFontSizePt: 8.5 },
            { key: 'vetPhone', label: 'Veterinarian Contact', previewValue: pi?.vetPhone || '', insertText: '{{VET_PHONE}}', defaultFontSizePt: 8 },
            { key: 'allergiesOrMedical', label: 'Diet / Medical Notes', previewValue: pi?.allergiesOrMedical || '', insertText: '{{ALLERGIES}}', defaultFontSizePt: 7.5 },
            { key: 'personalAddress', label: 'Home Address', previewValue: pi?.personalAddress || '', insertText: '{{PERSONAL_ADDRESS}}', defaultFontSizePt: 7.5 },
            { key: 'cityState', label: 'City & State', previewValue: [pi?.city, pi?.state].filter(Boolean).join(', '), insertText: '{{CITY_STATE}}', defaultFontSizePt: 8 },
          ]
        : activeStudioProfileType === 'belongings'
          ? [
              { key: 'fullName', label: 'Owner / Item Label', previewValue: pi?.fullName || '', insertText: '{{FULL_NAME}}', defaultFontSizePt: 12, defaultBold: true },
              {
                key: 'itemCategory',
                label: 'Item Category',
                previewValue:
                  pi?.itemCategory === 'Other' && pi?.itemCategoryOther?.trim()
                    ? pi.itemCategoryOther.trim()
                    : pi?.itemCategory || '',
                insertText: '{{ITEM_CATEGORY}}',
                defaultFontSizePt: 9,
              },
              { key: 'brandModel', label: 'Brand / Model', previewValue: pi?.brandModel || '', insertText: '{{BRAND_MODEL}}', defaultFontSizePt: 8.5, defaultBold: true },
              { key: 'serialNumber', label: 'Serial / Tag Reference', previewValue: pi?.serialNumber || '', insertText: '{{SERIAL_NUMBER}}', defaultFontSizePt: 8 },
              { key: 'bloodGroup', label: 'Blood Group (Rider / SOS)', previewValue: pi?.bloodGroup || '', insertText: '{{BLOOD_GROUP}}', defaultFontSizePt: 8.5, defaultBold: true },
              { key: 'emergencyContactPhone', label: 'Emergency Helpline', previewValue: pi?.emergencyContactPhone || '', insertText: '{{EMERGENCY_PHONE}}', defaultFontSizePt: 8.5, defaultBold: true },
              { key: 'mobile', label: 'Owner Mobile', previewValue: pi?.mobile || '', insertText: '{{MOBILE}}', defaultFontSizePt: 8.5 },
              { key: 'whatsapp', label: 'WhatsApp Number', previewValue: pi?.whatsapp || '', insertText: '{{WHATSAPP}}', defaultFontSizePt: 8 },
              { key: 'email', label: 'Owner Email', previewValue: pi?.email || '', insertText: '{{EMAIL}}', defaultFontSizePt: 8 },
              { key: 'finderNotes', label: 'Finder / Reward Instructions', previewValue: pi?.finderNotes || '', insertText: '{{FINDER_NOTES}}', defaultFontSizePt: 7.5 },
              { key: 'personalAddress', label: 'Return Address', previewValue: pi?.personalAddress || '', insertText: '{{PERSONAL_ADDRESS}}', defaultFontSizePt: 7.5 },
              { key: 'cityState', label: 'City & State', previewValue: [pi?.city, pi?.state].filter(Boolean).join(', '), insertText: '{{CITY_STATE}}', defaultFontSizePt: 8 },
            ]
          : [
              { key: 'fullName', label: 'Full Name', previewValue: pi?.fullName || '', insertText: '{{FULL_NAME}}', defaultFontSizePt: 13, defaultBold: true },
              { key: 'jobTitle', label: 'Job Title', previewValue: pi?.jobTitle || '', insertText: '{{JOB_TITLE}}', defaultFontSizePt: 9 },
              { key: 'companyName', label: 'Company Name', previewValue: pi?.companyName || '', insertText: '{{COMPANY}}', defaultFontSizePt: 9, defaultBold: true },
              { key: 'businessCategory', label: 'Business Category', previewValue: pi?.businessCategory || '', insertText: '{{BUSINESS_CATEGORY}}', defaultFontSizePt: 8 },
              { key: 'mobile', label: 'Mobile Number', previewValue: pi?.mobile || '', insertText: '{{MOBILE}}', defaultFontSizePt: 8 },
              { key: 'alternateMobile', label: 'Alternate Mobile', previewValue: pi?.alternateMobile || '', insertText: '{{ALTERNATE_MOBILE}}', defaultFontSizePt: 8 },
              { key: 'whatsapp', label: 'WhatsApp Number', previewValue: pi?.whatsapp || '', insertText: '{{WHATSAPP}}', defaultFontSizePt: 8 },
              { key: 'email', label: 'Email Address', previewValue: pi?.email || '', insertText: '{{EMAIL}}', defaultFontSizePt: 8 },
              { key: 'alternateEmail', label: 'Alternate Email', previewValue: pi?.alternateEmail || '', insertText: '{{ALTERNATE_EMAIL}}', defaultFontSizePt: 8 },
              { key: 'website', label: 'Website', previewValue: pi?.website || '', insertText: '{{WEBSITE}}', defaultFontSizePt: 8 },
              { key: 'bloodGroup', label: 'Blood Group', previewValue: pi?.bloodGroup || '', insertText: '{{BLOOD_GROUP}}', defaultFontSizePt: 8 },
              { key: 'emergencyContactPhone', label: 'Emergency Phone', previewValue: pi?.emergencyContactPhone || '', insertText: '{{EMERGENCY_PHONE}}', defaultFontSizePt: 8 },
              {
                key: 'cityState',
                label: 'City & State',
                previewValue: [pi?.city, pi?.state].filter(Boolean).join(', '),
                insertText: '{{CITY_STATE}}',
                defaultFontSizePt: 8,
              },
              { key: 'businessAddress', label: 'Business Address', previewValue: pi?.businessAddress || '', insertText: '{{ADDRESS}}', defaultFontSizePt: 8 },
              { key: 'personalAddress', label: 'Personal Address', previewValue: pi?.personalAddress || '', insertText: '{{PERSONAL_ADDRESS}}', defaultFontSizePt: 8 },
              { key: 'shortBio', label: 'Short Bio', previewValue: pi?.shortBio || '', insertText: '{{SHORT_BIO}}', defaultFontSizePt: 7.5 },
            ];

  const customFieldOptions: ProfileCardFieldOption[] = (selectedProfile?.customFields || [])
    .filter((cf) => cf.label?.trim() || cf.value?.trim())
    .map((cf) => ({
      key: `cf_${cf.id}`,
      label: cf.label || 'Custom Field',
      previewValue: cf.value || '',
      insertText: cf.label ? `${cf.label}: ${cf.value}` : cf.value,
      defaultFontSizePt: 8,
    }));

  const allProfileFieldOptions = [...builtInFieldOptions, ...customFieldOptions];
  const filledFieldOptions = allProfileFieldOptions.filter((opt) => Boolean(opt.previewValue.trim()));

  const isFieldOnSide = (sideSpec: CardSideDesign, opt: ProfileCardFieldOption): boolean =>
    doesSideContainField(sideSpec, opt);

  const isFieldOnCurrentSide = (opt: ProfileCardFieldOption): boolean =>
    isFieldOnSide(currentSide, opt);

  const elementMatchesOption = (el: CardTextElement, opt: ProfileCardFieldOption): boolean => {
    if (el.fieldKey && el.fieldKey === opt.key) return true;
    if (el.fieldKeys && el.fieldKeys.includes(opt.key)) return true;
    const insert = opt.insertText.trim();
    const text = (el.text || '').trim();
    if (!text || !insert) return false;
    if (text === insert) return true;
    if (/^\{\{[A-Z0-9_]+\}\}$/.test(insert) && text.includes(insert)) return true;
    return detectFieldKeyFromText(text) === opt.key;
  };

  const activeProfileElementsOnSide = currentSide.elements.filter((el) =>
    allProfileFieldOptions.some((opt) => elementMatchesOption(el, opt))
  );
  const displayProfileDataChecked = activeProfileElementsOnSide.length > 0 || Boolean(currentSide.showAvatar);

  const activeFieldCount = allProfileFieldOptions.filter(isFieldOnCurrentSide).length;
  const frontFieldCount = allProfileFieldOptions.filter((o) => isFieldOnSide(frontDesign, o)).length;
  const backFieldCount = allProfileFieldOptions.filter((o) => isFieldOnSide(backDesign, o)).length;

  const createFieldElementForSide = (sideSpec: CardSideDesign, opt: ProfileCardFieldOption, indexSuffix = 0): CardTextElement => {
    const slot = getNextCleanCardTextSlot(sideSpec);
    const materializedText = opt.previewValue.trim()
      ? opt.key.startsWith('cf_')
        ? opt.insertText
        : opt.previewValue.trim()
      : opt.insertText;
    return {
      id: `fld_${opt.key}_${Date.now().toString(36)}_${indexSuffix}`,
      text: materializedText,
      fieldKey: opt.key,
      xPct: slot.xPct,
      yPct: slot.yPct,
      maxWidthPct: slot.maxWidthPct,
      fontSizePt: opt.defaultFontSizePt,
      fontFamily: 'Plus Jakarta Sans',
      fontWeight: opt.defaultBold ? 'bold' : 'normal',
      fontStyle: 'normal',
      textDecoration: 'none',
      color: getDefaultContrastColor(),
      align: 'left',
    };
  };

  const toggleDisplayAllProfileData = (checked: boolean) => {
    if (!checked) {
      hiddenProfileElementsRef.current[activeSide] = {
        elements: activeProfileElementsOnSide,
        showAvatar: Boolean(currentSide.showAvatar),
      };
      const removeIds = new Set(activeProfileElementsOnSide.map((el) => el.id));
      setCurrentSide({
        ...currentSide,
        showAvatar: false,
        elements: currentSide.elements.filter((el) => !removeIds.has(el.id)),
      });
      return;
    }
    const backup = hiddenProfileElementsRef.current[activeSide];
    if (backup && (backup.elements.length > 0 || backup.showAvatar)) {
      const existingIds = new Set(currentSide.elements.map((e) => e.id));
      const restored = backup.elements.filter((e) => !existingIds.has(e.id));
      setCurrentSide({
        ...currentSide,
        showAvatar: Boolean(backup.showAvatar || currentSide.showAvatar),
        avatarDataUrl: currentSide.avatarDataUrl || pi?.photoDataUrl,
        avatarShape: currentSide.avatarShape || 'square',
        elements: [...currentSide.elements, ...restored],
      });
      return;
    }
    const baseList = filledFieldOptions.length > 0 ? filledFieldOptions : builtInFieldOptions.slice(0, 5);
    const runningSide: CardSideDesign = { ...currentSide, elements: [...currentSide.elements] };
    let added = 0;
    for (const opt of baseList) {
      if (isFieldOnSide(runningSide, opt)) continue;
      const item = createFieldElementForSide(runningSide, opt, added++);
      runningSide.elements.push(item);
    }
    setCurrentSide({
      ...runningSide,
      showAvatar: Boolean(currentSide.showAvatar),
      avatarDataUrl: currentSide.avatarDataUrl || pi?.photoDataUrl,
      avatarShape: currentSide.avatarShape || 'square',
    });
  };

  const toggleProfileFieldOnCard = (opt: ProfileCardFieldOption) => {
    const matches = currentSide.elements.filter((el) => elementMatchesOption(el, opt));
    if (matches.length > 0) {
      const matchIds = new Set(matches.map((m) => m.id));
      setCurrentSide({
        ...currentSide,
        elements: currentSide.elements.filter((el) => !matchIds.has(el.id)),
      });
      if (selectedElementId && matchIds.has(selectedElementId)) setSelectedTarget(null);
      if (editingTextId && matchIds.has(editingTextId)) setEditingTextId(null);
      return;
    }
    const newEl = createFieldElementForSide(currentSide, opt);
    setCurrentSide({ ...currentSide, elements: [...currentSide.elements, newEl] });
    setSelectedTarget({ kind: 'text', id: newEl.id });
  };

  const handleBackgroundUploadForSide = async (
    targetSide: 'front' | 'back',
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      notify(
        'Background file too large',
        'Please choose an image under 5 MB (recommended 1082 × 709 px at 300 DPI).',
        'error'
      );
      return;
    }
    try {
      const dataUrl = await compressImageFileToDataUrl(file, {
        maxWidth: orientation === 'vertical' ? 709 : 1082,
        maxHeight: orientation === 'vertical' ? 1082 : 709,
        maxChars: 280_000,
      });
      updateBackgroundForSide(targetSide, { backgroundImageUrl: dataUrl }, false);
      setActiveSide(targetSide);
      notify(
        `${targetSide === 'front' ? 'Front' : 'Back'} background updated`,
        'Fits card dimensions automatically. Replace or Remove anytime.',
        'success'
      );
    } catch {
      notify('Background upload failed', 'Could not read image. Please try PNG or JPG.', 'error');
    }
  };

  const handleStudioPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      notify('Image too large', 'Please upload an image smaller than 5 MB.', 'error');
      return;
    }
    try {
      const rawUrl = await readImageFileAsDataUrl(file);
      const autoFitted = await autoFitImageToSquareDataUrl(rawUrl);
      updateAvatarSide(
        {
          avatarDataUrl: autoFitted,
          avatarShape: currentSide.avatarShape || 'square',
          showAvatar: true,
        },
        false
      );
      setPhotoCropSource(rawUrl);
      setSelectedTarget({ kind: 'avatar' });
      setMode('custom');
      notify('Photo auto-fitted', 'Drag or zoom in the cropper to frame any part of your photo.', 'info');
    } catch {
      notify('Photo load failed', 'Could not read image. Try PNG or JPG.', 'error');
    }
  };

  const handleSaveDraft = async () => {
    if (!userRecord || !selectedProfile) return;
    setSaving(true);
    try {
      const designId = `des_${userRecord.uid.slice(0, 8)}_${Date.now()}`;
      const record: CardDesignRecord = {
        designId,
        uid: userRecord.uid,
        profileId: selectedProfile.profileId,
        templateId: selectedTpl.templateId,
        cardTechnology: selectedTpl.pricingMode === 'fixed_pack' ? 'qr_only' : cardTechnology,
        frontDesign,
        backDesign,
        cardOrientation: orientation,
        dimensions: orientation === 'vertical' ? '54x85.6mm' : '85.6x54mm',
        bleed: '3mm',
        approved: false,
        locked: false,
        version: 1,
        createdAt: '',
        updatedAt: '',
      };
      const prepared = await saveCardDesign(record);
      const savedRecord: CardDesignRecord = {
        ...record,
        frontDesign: prepared.frontDesign,
        backDesign: prepared.backDesign,
      };
      setFrontDesign(prepared.frontDesign);
      setBackDesign(prepared.backDesign);
      setSavedDesigns((prev) => [savedRecord, ...prev]);
      notify('Custom design saved', 'You can preview or resume this customized design anytime.', 'success');
    } catch (err) {
      notify('Save failed', formatFirestoreErrorMessage(err, 'Unable to save card design.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleApproveAndCheckout = async () => {
    if (!userRecord || !selectedProfile) return;
    if (!approvalChecked) {
      notify('Approval required', 'Please confirm the design approval checkbox first.', 'error');
      return;
    }
    setSaving(true);
    try {
      const designId = `des_${userRecord.uid.slice(0, 8)}_${Date.now()}`;
      const prepared = await saveCardDesign({
        designId,
        uid: userRecord.uid,
        profileId: selectedProfile.profileId,
        templateId: selectedTpl.templateId,
        cardTechnology: selectedTpl.pricingMode === 'fixed_pack' ? 'qr_only' : cardTechnology,
        frontDesign,
        backDesign,
        cardOrientation: orientation,
        dimensions: orientation === 'vertical' ? '54x85.6mm' : '85.6x54mm',
        bleed: '3mm',
        approved: true,
        locked: false,
        version: 1,
      });
      setFrontDesign(prepared.frontDesign);
      setBackDesign(prepared.backDesign);
      notify('Design approved & saved', 'Proceeding to checkout.', 'success');
      navigate(`/dashboard/checkout?designId=${designId}`);
    } catch (err) {
      notify('Save failed', formatFirestoreErrorMessage(err, 'Unable to save card design.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const activeProfileTypeLabel =
    PROFILE_TYPE_OPTIONS.find((o) => o.id === activeStudioProfileType)?.label || 'Adult';
  const activeContactSummary =
    effectiveProfileInfo.mobile ||
    effectiveProfileInfo.ownerMobile ||
    effectiveProfileInfo.parentMobile ||
    effectiveProfileInfo.email ||
    '';

  return (
    <PortalLayout portal="customer" title="Business Card Design Studio">
      <div className="space-y-5">
        {/* Active User Profile Bar & Switcher */}
        <div className="bg-white border border-[#E9E4F5] rounded-2xl p-4 sm:px-5 sm:py-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3.5">
          <div className="flex items-center gap-3.5 min-w-0">
            {effectiveProfileInfo.photoDataUrl ? (
              <img
                src={effectiveProfileInfo.photoDataUrl}
                alt={effectiveProfileInfo.fullName || selectedProfile?.profileLabel || 'User profile'}
                className="w-11 h-11 rounded-full object-cover border border-[#E9E4F5] shrink-0"
              />
            ) : (
              <div className="w-11 h-11 rounded-full bg-[#18142C] text-white flex items-center justify-center font-display text-sm font-bold shrink-0">
                {(effectiveProfileInfo.fullName || selectedProfile?.profileLabel || userRecord?.displayName || 'U')[0].toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-[11px] font-semibold text-slate-500">User Profile</span>
                <span className="text-slate-300" aria-hidden="true">·</span>
                <span className="font-display text-sm font-bold text-[#18142C] truncate">
                  {effectiveProfileInfo.fullName || selectedProfile?.profileLabel || userRecord?.displayName || 'No Profile Yet'}
                </span>
              </div>
              {selectedProfile ? (
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                  <span>{activeProfileTypeLabel}</span>
                  <span aria-hidden="true">·</span>
                  <span>{selectedProfile.profileLabel || 'Digital Profile'}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-slate-600">/p/{selectedProfile.slug}</span>
                  {activeContactSummary && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">{activeContactSummary}</span>
                    </>
                  )}
                </div>
              ) : (
                <div className="mt-0.5 text-xs text-slate-500">
                  Create a digital profile to populate your card and public link automatically.
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {profiles.length > 0 ? (
              <div className="flex items-center gap-2">
                <label
                  htmlFor="studio-user-profile-select"
                  className="text-xs font-semibold text-slate-600 whitespace-nowrap"
                >
                  Select User{profiles.length > 1 ? ` (${profiles.length})` : ''}:
                </label>
                <select
                  id="studio-user-profile-select"
                  value={selectedProfile?.profileId || ''}
                  onChange={(e) => {
                    const nextProf = profiles.find((p) => p.profileId === e.target.value) || null;
                    setSelectedProfile(nextProf);
                    if (userRecord && nextProf) {
                      localStorage.setItem(`tapnex_active_profile_${userRecord.uid}`, nextProf.profileId);
                      studioReadyRef.current = false;
                      hydrateDesignForProfile(nextProf, templates, savedDesigns, userRecord.uid, userRecord);
                      setTimeout(() => {
                        studioReadyRef.current = true;
                      }, 0);
                    }
                  }}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-[#18142C] bg-white min-w-[220px] max-w-[320px]"
                >
                  {profiles.map((p) => {
                    const pTypeLabel =
                      PROFILE_TYPE_OPTIONS.find((o) => o.id === (p.profileType || 'adult'))?.label || 'Adult';
                    const personName = p.personalInformation?.fullName?.trim();
                    const labelPart = p.profileLabel?.trim() || p.slug;
                    return (
                      <option key={p.profileId} value={p.profileId}>
                        {personName ? `${personName} — ${labelPart}` : labelPart} ({pTypeLabel})
                      </option>
                    );
                  })}
                </select>
              </div>
            ) : (
              <Link
                to="/dashboard/profile"
                className="px-3.5 py-2 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold whitespace-nowrap"
              >
                Create User Profile
              </Link>
            )}
            <Link
              to="/dashboard/profile"
              className="px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-[#FAF9FE] text-xs font-semibold text-slate-700 whitespace-nowrap"
            >
              Edit Profile
            </Link>
          </div>
        </div>

        {/* Top Studio Toolbar */}
        <div className="bg-white border border-[#E9E4F5] rounded-2xl p-4 sm:p-5 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setMode('default')}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors min-h-[38px] ${
                mode === 'default' ? 'bg-[#18142C] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              1. Card Templates
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('custom');
                if (!selectedTarget && currentSide.elements.length > 0) {
                  setSelectedTarget({ kind: 'text', id: currentSide.elements[0].id });
                  setCustomizeTab('text');
                }
              }}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors min-h-[38px] ${
                mode === 'custom' ? 'bg-[#18142C] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              2. Customize Card
            </button>

            <button
              type="button"
              onClick={() => handleStartBlankCard()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 hover:bg-[#FAF9FE] text-xs font-semibold min-h-[38px]"
            >
              <Sparkles className="h-3.5 w-3.5 text-[#7C3AED]" />
              <span>Blank Canvas</span>
            </button>

            <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-[#7C3AED] bg-[#F3EEFF]/80 text-[#7C3AED] hover:bg-[#EAE3FF] text-xs font-semibold min-h-[38px] cursor-pointer">
              <Upload className="h-3.5 w-3.5" />
              <span>Upload Front Design</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleSideDesignUpload('front', e)}
              />
            </label>

            <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-emerald-600 bg-emerald-50/70 text-emerald-700 hover:bg-emerald-100 text-xs font-semibold min-h-[38px] cursor-pointer">
              <Upload className="h-3.5 w-3.5" />
              <span>Upload Back Design</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleSideDesignUpload('back', e)}
              />
            </label>

            {/* Card Fields Quick Dropdown (Checkbox selector for saved profile data) */}
            <div className="relative" ref={fieldsDropdownRef}>
              <button
                type="button"
                onClick={() => setFieldsDropdownOpen((prev) => !prev)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100 text-xs font-semibold min-h-[38px]"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Card Fields ({activeSide === 'front' ? 'Front' : 'Back'})</span>
                <span className="px-1.5 py-0.5 rounded bg-indigo-600 text-white text-[10px] font-bold tabular-nums">
                  {activeFieldCount}
                </span>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${fieldsDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {fieldsDropdownOpen && (
                <div className="absolute left-0 mt-2 w-80 max-w-[90vw] bg-white border border-[#E9E4F5] rounded-xl shadow-xl z-40 p-3 space-y-2">
                  <label className="flex items-center justify-between gap-2 pb-2 border-b border-[#F0ECF9] cursor-pointer">
                    <div>
                      <div className="text-xs font-bold text-[#18142C]">
                        Display Profile Data on {activeSide === 'front' ? 'Front' : 'Back'}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Check fields below to display on card
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={displayProfileDataChecked}
                      onChange={(e) => toggleDisplayAllProfileData(e.target.checked)}
                      className="h-4 w-4 accent-[#7C3AED]"
                    />
                  </label>

                  {/* Quick Photo Toggle */}
                  <label className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-[#FAF9FE] hover:bg-slate-100 cursor-pointer border border-[#E9E4F5]">
                    <div className="flex items-center gap-2 min-w-0">
                      {pi?.photoDataUrl ? (
                        <img src={pi.photoDataUrl} alt="" className="w-6 h-6 rounded-full object-cover shrink-0 border border-slate-300" />
                      ) : (
                        <UserCircle2 className="w-5 h-5 text-slate-400 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-[#18142C]">Profile Photo</div>
                        <div className="text-[10px] text-slate-500">Show photo frame on {activeSide} side</div>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={Boolean(currentSide.showAvatar)}
                      onChange={(e) =>
                        updateAvatarSide(
                          {
                            avatarDataUrl: currentSide.avatarDataUrl || pi?.photoDataUrl || '',
                            avatarShape: currentSide.avatarShape || 'square',
                            showAvatar: e.target.checked,
                          },
                          false
                        )
                      }
                      className="h-4 w-4 accent-[#7C3AED]"
                    />
                  </label>

                  <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
                    {allProfileFieldOptions.map((opt) => {
                      const checked = isFieldOnCurrentSide(opt);
                      return (
                        <label
                          key={opt.key}
                          className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                            checked
                              ? 'bg-[#F3EEFF] border border-[#DDD6FE] text-[#18142C]'
                              : 'hover:bg-[#FAF9FE] border border-transparent text-slate-700'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-semibold truncate">{opt.label}</div>
                            <div className="text-[11px] text-slate-500 truncate">
                              {opt.previewValue || 'Uses placeholder until filled in My Profile'}
                            </div>
                          </div>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleProfileFieldOnCard(opt)}
                            className="h-4 w-4 accent-[#7C3AED] shrink-0"
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => addTextElement('Custom Text', true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold min-h-[38px]"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Custom Text</span>
            </button>

            <button
              type="button"
              onClick={() => setResetDesignModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-rose-200 bg-rose-50/70 text-xs font-semibold text-rose-700 hover:bg-rose-100 min-h-[38px]"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reset Design</span>
            </button>

            <button
              type="button"
              onClick={() => setPreviewModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#7C3AED]/30 bg-[#F3EEFF] text-xs font-semibold text-[#7C3AED] hover:bg-[#EAE3FF] min-h-[38px]"
            >
              <Eye className="h-3.5 w-3.5" />
              <span>Preview</span>
            </button>

            <button
              type="button"
              disabled={saving || !selectedProfile}
              onClick={handleSaveDraft}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-[#FAF9FE] disabled:opacity-50 min-h-[38px]"
            >
              <Save className="h-3.5 w-3.5" />
              <span>Save Draft</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* All Templates Dropdown (applied directly to Customized Design) */}
            <div className="flex items-center gap-1.5">
              <label htmlFor="studio-template-dropdown" className="text-[11px] font-semibold text-slate-500">
                Template:
              </label>
              <select
                id="studio-template-dropdown"
                value={selectedTpl.templateId}
                onChange={(e) => {
                  const found = allDropdownTemplates.find((t) => t.templateId === e.target.value);
                  if (found) {
                    applyTemplate(found, true);
                    notify('Template applied to custom studio', `Customizing ${found.name} — click any component to edit.`, 'info');
                  }
                }}
                className="px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-[#18142C] bg-white min-w-[200px]"
              >
                {allDropdownTemplates.map((tpl) => {
                  const p = resolveCardPricing(tpl, cardTechnology);
                  return (
                    <option key={tpl.templateId} value={tpl.templateId}>
                      {tpl.isDefault ? '★ ' : ''}
                      {tpl.name}
                      {tpl.isDefault ? ' [Default]' : ''} ({tpl.category || 'Card'} · ₹{p.unitPriceInr})
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="px-2.5 py-1.5 rounded-lg bg-[#F3EEFF] border border-[#DDD6FE] text-xs font-mono font-bold text-[#7C3AED] tabular-nums">
              ₹{studioPricing.unitPriceInr} · {studioPricing.editionLabel}
            </div>
            <div className="text-xs font-mono text-slate-600">
              {orientation === 'vertical' ? '54.0 × 85.6 mm' : '85.6 × 54.0 mm'} · 300 DPI
            </div>
          </div>
        </div>

        {/* Auto-Match Helper Banner when Dog or Helmet profile is active */}
        {recommendedTemplateForProfile &&
          recommendedTemplateForProfile.templateId !== selectedTpl.templateId &&
          (recommendedTemplateForProfile.templateId === 'pet-dog-tag-classic' ||
            recommendedTemplateForProfile.templateId === 'belongings-helmet-sticker-round') && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-emerald-950">
                <strong>Ready-to-Approve Match Found:</strong> Based on your{' '}
                {recommendedTemplateForProfile.templateId === 'pet-dog-tag-classic'
                  ? 'Dog profile'
                  : 'Helmet rider profile'}
                , load <strong>{recommendedTemplateForProfile.name}</strong> pre-filled with your details (
                {recommendedTemplateForProfile.packNote || `₹${recommendedTemplateForProfile.priceInr}`}).
              </div>
              <button
                type="button"
                onClick={() => {
                  applyTemplate(recommendedTemplateForProfile, false);
                  notify(
                    'Ready card loaded',
                    `${recommendedTemplateForProfile.name} populated with your profile info.`,
                    'success'
                  );
                }}
                className="px-3.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold shrink-0"
              >
                Load Pre-Filled Template
              </button>
            </div>
          )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Panel: Interactive Live 85.6 x 54 mm Canvas + Quick Format Bar */}
          <div className="lg:col-span-7 bg-white border border-[#E9E4F5] rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => {
                    setActiveSide('front');
                    setSelectedTarget(
                      mode === 'custom' && frontDesign.elements[0]
                        ? { kind: 'text', id: frontDesign.elements[0].id }
                        : null
                    );
                    setEditingTextId(null);
                  }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md ${
                    activeSide === 'front' ? 'bg-white text-[#18142C] shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Front Side
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveSide('back');
                    setSelectedTarget(
                      mode === 'custom' && backDesign.elements[0]
                        ? { kind: 'text', id: backDesign.elements[0].id }
                        : null
                    );
                    setEditingTextId(null);
                  }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md ${
                    activeSide === 'back' ? 'bg-white text-[#18142C] shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Back Side
                </button>
              </div>

              <div className="flex items-center gap-2">
                {selectedTpl.supportsVertical && (
                  <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setOrientation('landscape')}
                      className={`px-2.5 py-1 text-xs font-medium rounded ${
                        orientation === 'landscape' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                      }`}
                    >
                      Landscape
                    </button>
                    <button
                      type="button"
                      onClick={() => setOrientation('vertical')}
                      className={`px-2.5 py-1 text-xs font-medium rounded ${
                        orientation === 'vertical' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                      }`}
                    >
                      Vertical
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setPreviewModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#18142C] text-white text-xs font-semibold hover:bg-[#2A2048]"
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span>Full Preview</span>
                </button>
              </div>
            </div>

            <div className="py-5 px-3 sm:px-5 bg-[#FAF9FE] rounded-xl border border-[#E9E4F5] space-y-3">
              {/* Strictly NEVER pass actualQrPng here: Pre-purchase shows placeholder ONLY */}
              <CardCanvasPreview
                side={currentSide}
                orientation={orientation}
                personalInfo={effectiveProfileInfo}
                showPrintGuides
                interactive
                editResolvedText
                selectedTarget={selectedTarget}
                selectedTargets={selectedTargets}
                onSelectTarget={handleSelectTarget}
                onMoveItem={handleCanvasMove}
                onDragEnd={() => {
                  lastGestureRef.current = null;
                  setGuidelines({ vertical: [], horizontal: [] });
                }}
                guidelines={guidelines}
                editingTextId={editingTextId}
                onStartEditText={setEditingTextId}
                onUpdateTextValue={updateElementTextById}
              />

              {/* Multi-Select & Alignment Toolbar */}
              {mode === 'custom' && selectedTargets.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white border border-[#E9E4F5] shadow-2xs">
                  <div className="flex items-center gap-2 text-[11px] text-slate-600">
                    <span className="font-bold text-[#18142C]">
                      {selectedTargets.length} selected
                    </span>
                    <span className="hidden sm:inline text-slate-400">
                      · Shift/Ctrl+Click multi-select · Arrows move (Ctrl+Arrow 1pt)
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {(
                      [
                        { action: 'left', title: 'Align Left', icon: <AlignLeft className="h-3.5 w-3.5" /> },
                        { action: 'center', title: 'Align Center (Horizontal)', icon: <AlignCenter className="h-3.5 w-3.5" /> },
                        { action: 'right', title: 'Align Right', icon: <AlignRight className="h-3.5 w-3.5" /> },
                        { action: 'top', title: 'Align Top', icon: <ArrowUpToLine className="h-3.5 w-3.5" /> },
                        { action: 'middle', title: 'Align Middle (Vertical)', icon: <AlignVerticalJustifyCenter className="h-3.5 w-3.5" /> },
                        { action: 'bottom', title: 'Align Bottom', icon: <ArrowDownToLine className="h-3.5 w-3.5" /> },
                      ] as const
                    ).map((btn) => (
                      <button
                        key={btn.action}
                        type="button"
                        onClick={() => handleAlignSelected(btn.action)}
                        title={btn.title}
                        className="p-1.5 rounded-lg border border-[#E9E4F5] bg-[#FAF9FE] hover:bg-[#7C3AED] hover:text-white hover:border-[#7C3AED] text-slate-700 transition-colors"
                      >
                        {btn.icon}
                      </button>
                    ))}
                    {selectedTargets.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setSelectedTarget(null)}
                        className="ml-1 px-2 py-1 rounded-lg border border-[#E9E4F5] text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              )}

              <p className="text-center text-[11px] text-slate-500">
                <strong>Tip:</strong> Click to select (<strong>Shift/Ctrl+Click</strong> to multi-select) · <strong>Drag</strong> with snap guides ·{' '}
                <strong>Arrow keys</strong> to move (<strong>Ctrl+Arrow</strong> for 1pt) · <strong>Double-click text</strong> to edit.
              </p>
            </div>

            {/* Quick Contextual Formatting Toolbar right beneath Canvas */}
            {selectedEl ? (
              <div className="rounded-xl border border-[#DDD6FE] bg-[#F3EEFF]/50 p-3.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#18142C]">
                    <Type className="h-3.5 w-3.5 text-[#7C3AED]" />
                    <span>Quick Edit Selected Text</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {renderElementHistoryButtons(activeSide, { kind: 'text', id: selectedEl.id }, 'selected text', true)}
                    <button
                      type="button"
                      onClick={() => setEditingTextId(selectedEl.id)}
                      className="px-2.5 py-1 rounded-md border border-[#C4B5FD] bg-white text-[11px] font-semibold text-[#7C3AED] hover:bg-[#F3EEFF]"
                    >
                      Edit on Card
                    </button>
                    <button
                      type="button"
                      onClick={duplicateSelectedText}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-300 bg-white text-[11px] font-semibold text-slate-700 hover:bg-[#FAF9FE]"
                      title="Duplicate text"
                    >
                      <Copy className="h-3 w-3" />
                      <span>Duplicate</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeElementById(selectedEl.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-rose-200 bg-white text-[11px] font-semibold text-rose-600 hover:bg-rose-50"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={
                      /\{\{[A-Z0-9_]+\}\}/.test(selectedEl.text)
                        ? resolveCardTokens(selectedEl.text, pi || {})
                        : selectedEl.text
                    }
                    onChange={(e) => updateSelectedEl({ text: e.target.value }, true)}
                    placeholder="Type text or use Profile Info dropdown..."
                    className="flex-1 min-w-[180px] px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                  />
                  <select
                    value={selectedEl.fontFamily}
                    onChange={(e) => updateSelectedEl({ fontFamily: e.target.value })}
                    className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white max-w-[160px]"
                  >
                    {SYSTEM_FONTS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={6}
                      max={28}
                      value={selectedEl.fontSizePt}
                      onChange={(e) => updateSelectedEl({ fontSizePt: Number(e.target.value) })}
                      className="w-14 px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                      title="Font size (pt)"
                    />
                    <span className="text-[11px] text-slate-500">pt</span>
                  </div>
                  <div className="w-56">
                    <ColorPaletteField
                      compact
                      value={selectedEl.color}
                      onChange={(hex) => updateSelectedEl({ color: hex })}
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => updateSelectedEl({ fontWeight: selectedEl.fontWeight === 'bold' ? 'normal' : 'bold' })}
                      className={`p-1.5 rounded border ${
                        selectedEl.fontWeight === 'bold'
                          ? 'bg-[#18142C] text-white border-[#18142C]'
                          : 'bg-white text-slate-700 border-slate-300'
                      }`}
                      title="Bold"
                    >
                      <Bold className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => updateSelectedEl({ fontStyle: selectedEl.fontStyle === 'italic' ? 'normal' : 'italic' })}
                      className={`p-1.5 rounded border ${
                        selectedEl.fontStyle === 'italic'
                          ? 'bg-[#18142C] text-white border-[#18142C]'
                          : 'bg-white text-slate-700 border-slate-300'
                      }`}
                      title="Italic"
                    >
                      <Italic className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        updateSelectedEl({
                          textDecoration: selectedEl.textDecoration === 'underline' ? 'none' : 'underline',
                        })
                      }
                      className={`p-1.5 rounded border ${
                        selectedEl.textDecoration === 'underline'
                          ? 'bg-[#18142C] text-white border-[#18142C]'
                          : 'bg-white text-slate-700 border-slate-300'
                      }`}
                      title="Underline"
                    >
                      <Underline className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-1">
                    {(['left', 'center', 'right'] as const).map((al) => (
                      <button
                        key={al}
                        type="button"
                        onClick={() => updateSelectedEl({ align: al })}
                        className={`p-1.5 rounded border ${
                          selectedEl.align === al
                            ? 'bg-[#18142C] text-white border-[#18142C]'
                            : 'bg-white text-slate-700 border-slate-300'
                        }`}
                        title={`Align ${al}`}
                      >
                        {al === 'left' ? (
                          <AlignLeft className="h-3.5 w-3.5" />
                        ) : al === 'center' ? (
                          <AlignCenter className="h-3.5 w-3.5" />
                        ) : (
                          <AlignRight className="h-3.5 w-3.5" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : selectedTarget?.kind === 'avatar' ? (
              <div className="rounded-xl border border-[#DDD6FE] bg-[#F3EEFF]/50 p-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[#18142C]">Selected: Profile Photo ({currentSide.avatarSizeMm || 13} mm)</span>
                  {renderElementHistoryButtons(activeSide, { kind: 'avatar' }, 'profile photo', true)}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1 bg-white border border-slate-300 rounded-lg p-0.5">
                    {(['square', 'rounded', 'circle'] as const).map((shp) => (
                      <button
                        key={shp}
                        type="button"
                        onClick={() => updateAvatarSide({ avatarShape: shp })}
                        className={`px-2 py-1 rounded text-[11px] font-semibold capitalize ${
                          (currentSide.avatarShape || 'square') === shp
                            ? 'bg-[#18142C] text-white'
                            : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {shp}
                      </button>
                    ))}
                  </div>
                  <input
                    type="range"
                    min={8}
                    max={54}
                    value={currentSide.avatarSizeMm || 13}
                    onChange={(e) => resizeAvatarSizeMm(Number(e.target.value))}
                    className="w-24"
                  />
                  <label className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-[#FAF9FE] cursor-pointer">
                    <Upload className="h-3.5 w-3.5" />
                    <span>Upload</span>
                    <input type="file" accept="image/*" className="hidden" onChange={handleStudioPhotoUpload} />
                  </label>
                  {(currentSide.avatarDataUrl || pi?.photoDataUrl) && (
                    <button
                      type="button"
                      onClick={() => setPhotoCropSource(currentSide.avatarDataUrl || pi?.photoDataUrl || null)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#C4B5FD] bg-white text-xs font-semibold text-[#7C3AED] hover:bg-[#F3EEFF]"
                    >
                      <Crop className="h-3.5 w-3.5" />
                      <span>Crop</span>
                    </button>
                  )}
                  <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(currentSide.showAvatarBorder)}
                      onChange={(e) => updateAvatarSide({ showAvatarBorder: e.target.checked })}
                      className="h-3.5 w-3.5 accent-[#7C3AED]"
                    />
                    <span>Border</span>
                  </label>
                  {currentSide.showAvatarBorder && (
                    <div className="w-48">
                      <ColorPaletteField
                        compact
                        value={currentSide.avatarBorderColor || '#FFFFFF'}
                        onChange={(hex) => updateAvatarSide({ avatarBorderColor: hex })}
                      />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      updateAvatarSide({ showAvatar: false });
                      setSelectedTarget(null);
                    }}
                    className="px-2.5 py-1.5 rounded-lg border border-rose-200 bg-white text-xs font-semibold text-rose-600"
                  >
                    Hide Photo
                  </button>
                </div>
              </div>
            ) : selectedShape ? (
              <div className="rounded-xl border border-[#DDD6FE] bg-[#F3EEFF]/50 p-3.5 flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[#18142C]">
                    Selected Shape ({selectedShape.kind})
                  </span>
                  {renderElementHistoryButtons(activeSide, { kind: 'shape', id: selectedShape.id }, 'selected shape', true)}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="w-52">
                    <ColorPaletteField
                      compact
                      allowTransparent
                      value={selectedShape.color}
                      onChange={(hex) => updateSelectedShape({ color: hex, gradientTo: '' })}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setCustomizeTab('shapes')}
                    className="px-2.5 py-1.5 rounded-lg border border-[#C4B5FD] bg-white text-xs font-semibold text-[#7C3AED] hover:bg-[#F3EEFF]"
                  >
                    Size / Rotate / Border
                  </button>
                  <button
                    type="button"
                    onClick={duplicateSelectedShape}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-[#FAF9FE]"
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    onClick={() => removeShapeById(selectedShape.id)}
                    className="px-2.5 py-1.5 rounded-lg border border-rose-200 bg-white text-xs font-semibold text-rose-600"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ) : selectedTarget?.kind === 'logo' ? (
              <div className="rounded-xl border border-[#DDD6FE] bg-[#F3EEFF]/50 p-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[#18142C]">Selected: Company Logo ({currentSide.logoWidthMm || 14} mm)</span>
                  {renderElementHistoryButtons(activeSide, { kind: 'logo' }, 'company logo', true)}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="range"
                    min={8}
                    max={54}
                    value={currentSide.logoWidthMm || 14}
                    onChange={(e) => resizeLogoWidthMm(Number(e.target.value))}
                    className="w-28"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      updateLogoSide({ logoDataUrl: '' });
                      setSelectedTarget(null);
                    }}
                    className="px-2.5 py-1.5 rounded-lg border border-rose-200 bg-white text-xs font-semibold text-rose-600"
                  >
                    Remove Logo
                  </button>
                </div>
              </div>
            ) : selectedTarget?.kind === 'qr' ? (
              <div className="rounded-xl border border-[#DDD6FE] bg-[#F3EEFF]/50 p-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[#18142C]">Selected: QR Code Slot ({currentSide.qrSizeMm} mm)</span>
                  {renderElementHistoryButtons(activeSide, { kind: 'qr' }, 'QR code slot', true)}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="range"
                    min={12}
                    max={28}
                    value={currentSide.qrSizeMm}
                    onChange={(e) => updateQrSide({ qrSizeMm: Number(e.target.value) }, true)}
                    className="w-28"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      updateQrSide({ showQrSlot: false });
                      setSelectedTarget(null);
                    }}
                    className="px-2.5 py-1.5 rounded-lg border border-rose-200 bg-white text-xs font-semibold text-rose-600"
                  >
                    Hide QR Slot
                  </button>
                </div>
              </div>
            ) : selectedTarget?.kind === 'nfc' ? (
              <div className="rounded-xl border border-[#DDD6FE] bg-[#F3EEFF]/50 p-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[#18142C]">
                    Selected: SMART Wave Icon ({currentSide.nfcSizeMm || 6} mm)
                  </span>
                  {renderElementHistoryButtons(activeSide, { kind: 'nfc' }, 'SMART icon', true)}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="range"
                    min={3}
                    max={14}
                    step={0.5}
                    value={currentSide.nfcSizeMm || 6}
                    onChange={(e) => updateNfcSide({ nfcSizeMm: Number(e.target.value) }, true)}
                    className="w-28"
                  />
                  <div className="w-48">
                    <ColorPaletteField
                      compact
                      value={currentSide.nfcIconColor || '#38BDF8'}
                      onChange={(hex) => updateNfcSide({ nfcIconColor: hex })}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      updateNfcSide({ showNfcIcon: false });
                      setSelectedTarget(null);
                    }}
                    className="px-2.5 py-1.5 rounded-lg border border-rose-200 bg-white text-xs font-semibold text-rose-600"
                  >
                    Hide SMART Icon
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-xl bg-[#F3EEFF]/80 border border-[#DDD6FE] p-3.5 text-xs text-slate-700 flex items-start gap-2.5">
                <QrCode className="h-4 w-4 text-[#7C3AED] shrink-0 mt-0.5" />
                <span>
                  Templates open pre-filled with your editable profile details. Check or uncheck fields under{' '}
                  <strong>Information to Display on Card</strong> below, or click any element on the card to move and edit it.
                </span>
              </div>
            )}

            {/* Always-Visible Information to Display on Card Panel (Available in Template & Customize Modes) */}
            <div className="rounded-xl border border-[#E9E4F5] bg-[#FAF9FE]/80 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[#E9E4F5]">
                <div>
                  <h3 className="font-display font-bold text-sm text-[#18142C]">
                    Information to Display on Card
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Choose which saved details appear on the{' '}
                    <strong className="text-[#18142C]">{activeSide === 'front' ? 'Front Side' : 'Back Side'}</strong>{' '}
                    of your card ({selectedProfile?.profileLabel || 'Primary Profile'} ·{' '}
                    <Link to="/dashboard/profile" className="text-[#7C3AED] hover:underline font-medium">
                      Edit Profile Info
                    </Link>
                    )
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <div className="flex items-center gap-0.5 p-0.5 bg-white border border-[#E9E4F5] rounded-lg">
                    <button
                      type="button"
                      onClick={() => setActiveSide('front')}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                        activeSide === 'front' ? 'bg-[#18142C] text-white' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      Front ({frontFieldCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveSide('back')}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                        activeSide === 'back' ? 'bg-[#18142C] text-white' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      Back ({backFieldCount})
                    </button>
                  </div>

                  <label className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-indigo-200 bg-indigo-50 text-[11px] font-semibold text-indigo-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={displayProfileDataChecked}
                      onChange={(e) => toggleDisplayAllProfileData(e.target.checked)}
                      className="h-3.5 w-3.5 accent-[#7C3AED]"
                    />
                    <span>Show Filled Details</span>
                  </label>
                </div>
              </div>

              {/* Quick Toggle Strip: Photo / QR Slot / SMART Wave */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <label
                  className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                    currentSide.showAvatar
                      ? 'bg-white border-[#C4B5FD] text-[#18142C] font-semibold'
                      : 'bg-white/60 border-[#E9E4F5] text-slate-600 hover:bg-white'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    {pi?.photoDataUrl ? (
                      <img
                        src={pi.photoDataUrl}
                        alt=""
                        className="w-5 h-5 rounded-full object-cover shrink-0 border border-slate-300"
                      />
                    ) : (
                      <UserCircle2 className="w-4 h-4 text-slate-400 shrink-0" />
                    )}
                    <span className="truncate">Profile Photo</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={Boolean(currentSide.showAvatar)}
                    onChange={(e) =>
                      setCurrentSide({
                        ...currentSide,
                        avatarDataUrl: currentSide.avatarDataUrl || pi?.photoDataUrl || '',
                        avatarShape: currentSide.avatarShape || 'square',
                        showAvatar: e.target.checked,
                      })
                    }
                    className="h-4 w-4 accent-[#7C3AED] shrink-0"
                  />
                </label>

                <label
                  className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                    currentSide.showQrSlot
                      ? 'bg-white border-[#C4B5FD] text-[#18142C] font-semibold'
                      : 'bg-white/60 border-[#E9E4F5] text-slate-600 hover:bg-white'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <QrCode className="w-4 h-4 text-[#7C3AED] shrink-0" />
                    <span className="truncate">QR Code Slot</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={Boolean(currentSide.showQrSlot)}
                    onChange={(e) => setCurrentSide({ ...currentSide, showQrSlot: e.target.checked })}
                    className="h-4 w-4 accent-[#7C3AED] shrink-0"
                  />
                </label>

                <label
                  className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                    currentSide.showNfcIcon
                      ? 'bg-white border-[#C4B5FD] text-[#18142C] font-semibold'
                      : 'bg-white/60 border-[#E9E4F5] text-slate-600 hover:bg-white'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Wifi className="w-4 h-4 text-[#7C3AED] rotate-90 shrink-0" />
                    <span className="truncate">SMART Wave Icon</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={Boolean(currentSide.showNfcIcon)}
                    onChange={(e) => setCurrentSide({ ...currentSide, showNfcIcon: e.target.checked })}
                    className="h-4 w-4 accent-[#7C3AED] shrink-0"
                  />
                </label>
              </div>

              {/* Selectable Profile Fields Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-60 overflow-y-auto pr-1">
                {allProfileFieldOptions.map((opt) => {
                  const checkedOnCurrent = isFieldOnCurrentSide(opt);
                  const oppositeSide = activeSide === 'front' ? 'back' : 'front';
                  const checkedOnOpposite = isFieldOnSide(
                    oppositeSide === 'front' ? frontDesign : backDesign,
                    opt
                  );
                  return (
                    <label
                      key={opt.key}
                      className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border text-left cursor-pointer transition-colors ${
                        checkedOnCurrent
                          ? 'bg-white border-[#7C3AED]/50 ring-1 ring-[#7C3AED]/20 text-[#18142C]'
                          : 'bg-white/70 border-[#E9E4F5] text-slate-700 hover:bg-white'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold truncate">{opt.label}</span>
                          {checkedOnOpposite && !checkedOnCurrent && (
                            <span className="text-[10px] font-medium text-slate-500">
                              · on {oppositeSide}
                            </span>
                          )}
                        </div>
                        <div
                          className={`text-[11px] truncate ${
                            opt.previewValue ? 'text-slate-600' : 'text-slate-400 italic'
                          }`}
                        >
                          {opt.previewValue || 'Empty in My Profile (editable on card)'}
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={checkedOnCurrent}
                        onChange={() => toggleProfileFieldOnCard(opt)}
                        className="h-4 w-4 accent-[#7C3AED] shrink-0"
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Panel: Template Picker or Tabbed Visual Editor */}
          <div className="lg:col-span-5 bg-white border border-[#E9E4F5] rounded-2xl p-5 sm:p-6 space-y-5">
            {mode === 'default' ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-display font-bold text-base text-[#18142C]">
                    Select Predefined or Blank Template
                  </h2>
                  <span className="text-[11px] font-mono text-slate-500">
                    {allDropdownTemplates.length} templates
                  </span>
                </div>

                {/* Profile Type Filter Tabs */}
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      { id: 'recommended', label: 'Recommended' },
                      { id: 'all', label: 'All Types' },
                      { id: 'adult', label: 'Adult' },
                      { id: 'kids', label: 'Kids' },
                      { id: 'pets', label: 'Pets' },
                      { id: 'belongings', label: 'Belongings' },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setTemplateProfileFilter(f.id)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                        templateProfileFilter === f.id
                          ? 'bg-[#18142C] text-white border-[#18142C]'
                          : 'bg-[#FAF9FE] text-slate-600 border-[#E9E4F5] hover:bg-slate-100'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Quick Template Dropdown (Loads into Customized Design)
                  </label>
                  <select
                    value={selectedTpl.templateId}
                    onChange={(e) => {
                      const found = allDropdownTemplates.find((t) => t.templateId === e.target.value);
                      if (found) {
                        applyTemplate(found, true);
                        notify('Template loaded for customization', `Edit any component on ${found.name}.`, 'info');
                      }
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-[#18142C] bg-white"
                  >
                    {allDropdownTemplates.map((tpl) => {
                      const p = resolveCardPricing(tpl, cardTechnology);
                      return (
                        <option key={tpl.templateId} value={tpl.templateId}>
                          {tpl.isDefault ? '★ ' : ''}
                          {tpl.name}
                          {tpl.isDefault ? ' [Default]' : ''} — {tpl.category || 'Standard'} (₹{p.unitPriceInr})
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2.5 max-h-[360px] overflow-y-auto pr-1">
                  {allDropdownTemplates.map((tpl) => {
                    const active = selectedTpl.templateId === tpl.templateId;
                    const p = resolveCardPricing(tpl, cardTechnology);
                    return (
                      <button
                        key={tpl.templateId}
                        type="button"
                        onClick={() => applyTemplate(tpl)}
                        className={`p-3 rounded-xl border text-left transition-colors ${
                          active ? 'border-[#7C3AED] bg-[#F3EEFF]/60' : 'border-[#E9E4F5] hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className="w-4 h-4 rounded-full border border-slate-300 shrink-0"
                            style={{ backgroundColor: tpl.frontSpec.backgroundColor }}
                          />
                          <div className="flex items-center gap-1.5">
                            {tpl.isDefault && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[9px] font-bold">
                                Default
                              </span>
                            )}
                            <span className="font-mono text-xs font-bold text-[#18142C] tabular-nums">
                              ₹{p.unitPriceInr}
                            </span>
                          </div>
                        </div>
                        <div className="mt-2 font-display text-xs font-bold text-[#18142C] truncate">
                          {tpl.name}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {p.packNote || tpl.cardType || tpl.category}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="p-3.5 rounded-xl border border-dashed border-slate-300 bg-[#FAF9FE] space-y-2.5">
                  <div className="text-xs font-semibold text-[#18142C]">Upload Custom Front &amp; Back Card Artwork</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#18142C] text-white text-xs font-semibold cursor-pointer hover:bg-[#2A2048]">
                      <Upload className="h-3.5 w-3.5" />
                      <span>Upload Front Design</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleSideDesignUpload('front', e)}
                      />
                    </label>
                    <label className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-700 text-white text-xs font-semibold cursor-pointer hover:bg-emerald-800">
                      <Upload className="h-3.5 w-3.5" />
                      <span>Upload Back Design</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleSideDesignUpload('back', e)}
                      />
                    </label>
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  Switch to <strong>2. Customize Card</strong> or click/drag any element on the preview to adjust text, shapes, photos, logo, SMART icon, or QR position.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-display font-bold text-base text-[#18142C]">
                    Customize {activeSide === 'front' ? 'Front' : 'Back'} Side
                  </h2>
                  <button
                    type="button"
                    onClick={() => addTextElement('Custom Text', true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-[#7C3AED] hover:bg-[#6D28D9] text-white rounded-lg text-xs font-semibold"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add Text</span>
                  </button>
                </div>

                {/* Clean 5-Tab Studio Inspector Navigation */}
                <div className="grid grid-cols-5 gap-1 p-1 bg-slate-100 rounded-xl">
                  {(
                    [
                      { id: 'text', label: 'Text & Data' },
                      { id: 'shapes', label: 'Shapes' },
                      { id: 'background', label: 'Front / Back' },
                      { id: 'media', label: 'Photo / Logo' },
                      { id: 'qr', label: 'QR & SMART' },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setCustomizeTab(t.id)}
                      className={`py-2 px-1 rounded-lg text-[10.5px] font-semibold transition-colors ${
                        customizeTab === t.id ? 'bg-white text-[#18142C] shadow-xs' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {customizeTab === 'text' && (
                  <div className="space-y-3.5">
                    {/* Clickable Layer Chips for Every Text Item on Current Side (Supports Shift/Ctrl Multi-Select) */}
                    <div className="p-3 rounded-xl border border-[#E9E4F5] bg-[#FAF9FE]/70 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-slate-600">
                          Elements on {activeSide === 'front' ? 'Front' : 'Back'} ({currentSide.elements.length})
                        </span>
                        <span className="text-[11px] text-slate-400">Shift/Ctrl+Click multi-select</span>
                      </div>
                      {currentSide.elements.length === 0 ? (
                        <p className="text-xs text-slate-500">
                          No text items on this side. Use <strong>Profile Info</strong> above or <strong>+ Add Text</strong>.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {currentSide.elements.map((el) => {
                            const active = selectedTargets.some((t) => t.kind === 'text' && t.id === el.id);
                            return (
                              <button
                                key={el.id}
                                type="button"
                                onClick={(e) =>
                                  handleSelectTarget({ kind: 'text', id: el.id }, e.shiftKey || e.ctrlKey || e.metaKey)
                                }
                                onDoubleClick={() => {
                                  setSelectedTarget({ kind: 'text', id: el.id });
                                  setEditingTextId(el.id);
                                }}
                                className={`max-w-[190px] truncate px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                                  active
                                    ? 'bg-[#18142C] text-white border-[#18142C]'
                                    : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400'
                                }`}
                              >
                                {resolveCardTokens(el.text, pi || {}) || 'Empty Text'}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Full Selected Text Formatting & Position Inspector */}
                    {selectedEl ? (
                      <div className="p-4 rounded-xl bg-[#FAF9FE] border border-[#E9E4F5] space-y-3.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-bold text-[#18142C]">Text Formatting &amp; Position</span>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {renderElementHistoryButtons(activeSide, { kind: 'text', id: selectedEl.id }, 'selected text', true)}
                            <button
                              type="button"
                              onClick={() => setEditingTextId(selectedEl.id)}
                              className="text-[#7C3AED] hover:underline text-[11px] font-semibold px-1"
                            >
                              Edit on Card
                            </button>
                            <button
                              type="button"
                              onClick={duplicateSelectedText}
                              className="text-slate-600 hover:text-[#18142C] text-[11px] font-semibold inline-flex items-center gap-0.5 px-1"
                              title="Duplicate text"
                            >
                              <Copy className="h-3 w-3" />
                              <span>Copy</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => removeElementById(selectedEl.id)}
                              className="text-rose-600 hover:text-rose-700 text-[11px] font-semibold inline-flex items-center gap-0.5 px-1"
                            >
                              <Trash2 className="h-3 w-3" />
                              <span>Remove</span>
                            </button>
                          </div>
                        </div>

                        <div>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <label className="block text-[11px] font-medium text-slate-600">
                              Text Content
                            </label>
                            {/\{\{[A-Z0-9_]+\}\}/.test(selectedEl.text) && (
                              <span className="text-[10px] font-medium text-[#7C3AED] bg-[#F3EEFF] px-1.5 py-0.5 rounded">
                                Profile Auto-Fill · Type to edit
                              </span>
                            )}
                          </div>
                          <input
                            type="text"
                            value={
                              /\{\{[A-Z0-9_]+\}\}/.test(selectedEl.text)
                                ? resolveCardTokens(selectedEl.text, pi || {})
                                : selectedEl.text
                            }
                            onChange={(e) => updateSelectedEl({ text: e.target.value }, true)}
                            placeholder="Type text or pick from Profile Info..."
                            className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                          <div className="sm:col-span-2">
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">Font Style</label>
                            <select
                              value={selectedEl.fontFamily}
                              onChange={(e) => updateSelectedEl({ fontFamily: e.target.value })}
                              className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                              style={{ fontFamily: selectedEl.fontFamily }}
                            >
                              {SYSTEM_FONTS.map((f) => (
                                <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                                  {f.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">Size (pt)</label>
                            <input
                              type="number"
                              min={6}
                              max={28}
                              step={0.5}
                              value={selectedEl.fontSizePt}
                              onChange={(e) =>
                                updateSelectedEl({
                                  fontSizePt: Math.max(6, Math.min(28, Number(e.target.value) || 6)),
                                })
                              }
                              className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-mono bg-white"
                            />
                          </div>
                        </div>

                        {/* Bold, Italic, Underline & Alignment */}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                updateSelectedEl({
                                  fontWeight: selectedEl.fontWeight === 'bold' ? 'normal' : 'bold',
                                })
                              }
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-bold transition-colors ${
                                selectedEl.fontWeight === 'bold'
                                  ? 'bg-[#18142C] text-white border-[#18142C]'
                                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                              }`}
                              title="Bold"
                            >
                              <Bold className="h-3.5 w-3.5" />
                              <span>Bold</span>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                updateSelectedEl({
                                  fontStyle: selectedEl.fontStyle === 'italic' ? 'normal' : 'italic',
                                })
                              }
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs italic transition-colors ${
                                selectedEl.fontStyle === 'italic'
                                  ? 'bg-[#18142C] text-white border-[#18142C]'
                                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                              }`}
                              title="Italic"
                            >
                              <Italic className="h-3.5 w-3.5" />
                              <span>Italic</span>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                updateSelectedEl({
                                  textDecoration: selectedEl.textDecoration === 'underline' ? 'none' : 'underline',
                                })
                              }
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs underline transition-colors ${
                                selectedEl.textDecoration === 'underline'
                                  ? 'bg-[#18142C] text-white border-[#18142C]'
                                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                              }`}
                              title="Underline"
                            >
                              <Underline className="h-3.5 w-3.5" />
                              <span>Underline</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => updateSelectedEl({ uppercase: !selectedEl.uppercase })}
                              className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border text-xs font-bold transition-colors ${
                                selectedEl.uppercase
                                  ? 'bg-[#18142C] text-white border-[#18142C]'
                                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                              }`}
                              title="Uppercase"
                            >
                              <span>AA</span>
                            </button>
                          </div>

                          <div className="flex items-center gap-1">
                            {(['left', 'center', 'right'] as const).map((al) => (
                              <button
                                key={al}
                                type="button"
                                onClick={() => updateSelectedEl({ align: al })}
                                className={`p-1.5 rounded-lg border transition-colors ${
                                  selectedEl.align === al
                                    ? 'bg-[#7C3AED] text-white border-[#7C3AED]'
                                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                                }`}
                                title={`Align ${al}`}
                              >
                                {al === 'left' ? (
                                  <AlignLeft className="h-3.5 w-3.5" />
                                ) : al === 'center' ? (
                                  <AlignCenter className="h-3.5 w-3.5" />
                                ) : (
                                  <AlignRight className="h-3.5 w-3.5" />
                                )}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Text Color Picker, Hex Paste & Saved Palette */}
                        <ColorPaletteField
                          label="Text Color (Picker, Hex Paste & Recent Palette)"
                          value={selectedEl.color}
                          onChange={(hex) => updateSelectedEl({ color: hex })}
                        />

                        <div className="grid grid-cols-3 gap-2 pt-1 border-t border-[#E9E4F5]">
                          <div>
                            <label className="text-[11px] text-slate-500">X: {selectedEl.xPct}%</label>
                            <input
                              type="range"
                              min={2}
                              max={88}
                              value={selectedEl.xPct}
                              onChange={(e) => updateSelectedEl({ xPct: Number(e.target.value) }, true)}
                              className="w-full"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] text-slate-500">Y: {selectedEl.yPct}%</label>
                            <input
                              type="range"
                              min={2}
                              max={88}
                              value={selectedEl.yPct}
                              onChange={(e) => updateSelectedEl({ yPct: Number(e.target.value) }, true)}
                              className="w-full"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] text-slate-500">Box Width: {selectedEl.maxWidthPct ?? 88}%</label>
                            <input
                              type="range"
                              min={20}
                              max={96}
                              value={selectedEl.maxWidthPct ?? 88}
                              onChange={(e) => updateSelectedEl({ maxWidthPct: Number(e.target.value) }, true)}
                              className="w-full"
                            />
                          </div>
                        </div>

                        {/* Curved / Arch Text Controls */}
                        <div className="pt-2 border-t border-[#E9E4F5] space-y-1.5">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-medium text-slate-600">
                              Arch / Curve: <span className="font-mono">{selectedEl.curveDeg || 0}°</span>
                            </span>
                            {selectedEl.curveDeg ? (
                              <button
                                type="button"
                                onClick={() => updateSelectedEl({ curveDeg: 0 })}
                                className="text-[#7C3AED] hover:underline font-semibold"
                              >
                                Reset Flat
                              </button>
                            ) : (
                              <span className="text-slate-400">+Top arch / -Bottom arc</span>
                            )}
                          </div>
                          <input
                            type="range"
                            min={-130}
                            max={130}
                            step={5}
                            value={selectedEl.curveDeg || 0}
                            onChange={(e) => updateSelectedEl({ curveDeg: Number(e.target.value) }, true)}
                            className="w-full"
                          />
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 px-1">
                        Click a text chip above or any text directly on the card preview to edit text, font style, size, width, color, bold, italic, underline, or alignment.
                      </p>
                    )}
                    {/* Profile Data Checklist Card */}
                    <div className="p-3.5 rounded-xl border border-indigo-200 bg-indigo-50/50 space-y-2.5">
                      <label className="flex items-center justify-between gap-2 cursor-pointer">
                        <div>
                          <div className="text-xs font-bold text-[#18142C]">
                            Display Profile Data on {activeSide === 'front' ? 'Front' : 'Back'} Side
                          </div>
                          <div className="text-[11px] text-slate-600">
                            Toggle saved profile fields to show or hide on this card side
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={displayProfileDataChecked}
                          onChange={(e) => toggleDisplayAllProfileData(e.target.checked)}
                          className="h-4 w-4 accent-[#7C3AED] shrink-0"
                        />
                      </label>

                      <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-1 pt-1 border-t border-indigo-100">
                        <label
                          className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border text-[11px] cursor-pointer ${
                            currentSide.showAvatar
                              ? 'bg-white border-[#C4B5FD] text-[#18142C] font-semibold'
                              : 'bg-white/60 border-[#E9E4F5] text-slate-600'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={Boolean(currentSide.showAvatar)}
                            onChange={(e) =>
                              setCurrentSide({
                                ...currentSide,
                                avatarDataUrl: currentSide.avatarDataUrl || pi?.photoDataUrl || '',
                                avatarShape: currentSide.avatarShape || 'square',
                                showAvatar: e.target.checked,
                              })
                            }
                            className="h-3.5 w-3.5 accent-[#7C3AED] shrink-0"
                          />
                          <span className="truncate">Profile Photo</span>
                        </label>
                        {allProfileFieldOptions.map((opt) => {
                          const checked = isFieldOnCurrentSide(opt);
                          return (
                            <label
                              key={opt.key}
                              title={opt.previewValue || 'Not filled yet in My Profile'}
                              className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border text-[11px] cursor-pointer ${
                                checked
                                  ? 'bg-white border-[#C4B5FD] text-[#18142C] font-semibold'
                                  : 'bg-white/60 border-[#E9E4F5] text-slate-600'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleProfileFieldOnCard(opt)}
                                className="h-3.5 w-3.5 accent-[#7C3AED] shrink-0"
                              />
                              <span className="truncate">{opt.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {customizeTab === 'shapes' && (
                  <div className="space-y-3.5">
                    <div className="p-3 rounded-xl border border-[#E9E4F5] bg-[#FAF9FE]/70 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-[#18142C] flex items-center gap-1.5">
                          <Layers className="h-3.5 w-3.5 text-[#7C3AED]" />
                          <span>Card Shapes &amp; Accents ({(currentSide.shapes || []).length})</span>
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                        <button
                          type="button"
                          onClick={() => addShapeElement('rect')}
                          className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-[11px] font-semibold text-slate-700"
                        >
                          <Square className="h-3 w-3" />
                          <span>+ Panel</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => addShapeElement('circle')}
                          className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-[11px] font-semibold text-slate-700"
                        >
                          <Circle className="h-3 w-3" />
                          <span>+ Circle</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => addShapeElement('pill')}
                          className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-[11px] font-semibold text-slate-700"
                        >
                          <Sparkles className="h-3 w-3" />
                          <span>+ Badge</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => addShapeElement('line')}
                          className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-[11px] font-semibold text-slate-700"
                        >
                          <Minus className="h-3 w-3" />
                          <span>+ Line</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => addShapeElement('star')}
                          className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-[11px] font-semibold text-slate-700"
                        >
                          <Star className="h-3 w-3 text-rose-600" />
                          <span>+ Starburst</span>
                        </button>
                      </div>

                      {(currentSide.shapes || []).length === 0 ? (
                        <p className="text-xs text-slate-500">
                          No shapes on this side yet. Add a panel, circle, badge, starburst, or divider line above.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {(currentSide.shapes || []).map((shp, idx) => {
                            const active = selectedTargets.some((t) => t.kind === 'shape' && t.id === shp.id);
                            return (
                              <button
                                key={shp.id}
                                type="button"
                                onClick={(e) =>
                                  handleSelectTarget({ kind: 'shape', id: shp.id }, e.shiftKey || e.ctrlKey || e.metaKey)
                                }
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border ${
                                  active
                                    ? 'bg-[#18142C] text-white border-[#18142C]'
                                    : 'bg-white text-slate-700 border-slate-300'
                                }`}
                              >
                                <span
                                  className="w-2.5 h-2.5 rounded-full border border-slate-300"
                                  style={{ backgroundColor: shp.color === 'transparent' ? '#FFFFFF' : shp.color }}
                                />
                                <span>
                                  {shp.kind} #{idx + 1}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {selectedShape ? (
                      <div className="p-4 rounded-xl bg-[#FAF9FE] border border-[#E9E4F5] space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-bold text-[#18142C]">Edit Selected Shape</span>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {renderElementHistoryButtons(activeSide, { kind: 'shape', id: selectedShape.id }, 'selected shape', true)}
                            <button
                              type="button"
                              onClick={duplicateSelectedShape}
                              className="text-slate-600 hover:text-[#18142C] text-[11px] font-semibold inline-flex items-center gap-0.5 px-1"
                            >
                              <Copy className="h-3 w-3" />
                              <span>Copy</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => removeShapeById(selectedShape.id)}
                              className="text-rose-600 hover:text-rose-700 text-[11px] font-semibold inline-flex items-center gap-0.5 px-1"
                            >
                              <Trash2 className="h-3 w-3" />
                              <span>Remove</span>
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2.5">
                          <div>
                            <label className="block text-[11px] text-slate-600 mb-1">Shape Style</label>
                            <select
                              value={selectedShape.kind}
                              onChange={(e) =>
                                updateSelectedShape({ kind: e.target.value as CardShapeElement['kind'] })
                              }
                              className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                            >
                              <option value="rect">Rectangle / Panel</option>
                              <option value="circle">Circle / Ring</option>
                              <option value="pill">Pill Badge</option>
                              <option value="line">Divider Line</option>
                              <option value="star">Starburst Accent</option>
                            </select>
                          </div>
                          <div>
                            <ColorPaletteField
                              label="Shape Fill / Outline Only"
                              compact
                              allowTransparent
                              value={selectedShape.color}
                              onChange={(hex) => updateSelectedShape({ color: hex, gradientTo: '' })}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2.5">
                          <div>
                            <label className="block text-[11px] text-slate-600">
                              Width: {selectedShape.widthPct}%
                            </label>
                            <input
                              type="range"
                              min={1}
                              max={120}
                              value={selectedShape.widthPct}
                              onChange={(e) => updateSelectedShape({ widthPct: Number(e.target.value) }, true)}
                              className="w-full"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-600">
                              Height: {selectedShape.heightPct}%
                            </label>
                            <input
                              type="range"
                              min={1}
                              max={130}
                              value={selectedShape.heightPct}
                              onChange={(e) => updateSelectedShape({ heightPct: Number(e.target.value) }, true)}
                              className="w-full"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-600">X: {selectedShape.xPct}%</label>
                            <input
                              type="range"
                              min={-25}
                              max={95}
                              value={selectedShape.xPct}
                              onChange={(e) => updateSelectedShape({ xPct: Number(e.target.value) }, true)}
                              className="w-full"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-600">Y: {selectedShape.yPct}%</label>
                            <input
                              type="range"
                              min={-25}
                              max={95}
                              value={selectedShape.yPct}
                              onChange={(e) => updateSelectedShape({ yPct: Number(e.target.value) }, true)}
                              className="w-full"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-600">
                              Rotation: {selectedShape.rotationDeg || 0}°
                            </label>
                            <input
                              type="range"
                              min={-45}
                              max={45}
                              value={selectedShape.rotationDeg || 0}
                              onChange={(e) => updateSelectedShape({ rotationDeg: Number(e.target.value) }, true)}
                              className="w-full"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-600">
                              Border Width: {selectedShape.borderWidthPx || 0}px
                            </label>
                            <div className="space-y-1.5">
                              <input
                                type="range"
                                min={0}
                                max={6}
                                value={selectedShape.borderWidthPx || 0}
                                onChange={(e) => updateSelectedShape({ borderWidthPx: Number(e.target.value) }, true)}
                                className="w-full"
                              />
                              <ColorPaletteField
                                compact
                                value={selectedShape.borderColor || '#FFFFFF'}
                                onChange={(hex) => updateSelectedShape({ borderColor: hex })}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 px-1">
                        Click any shape/accent chip above or click directly on a bar, panel, or ring on the card to move, resize, recolor, or remove it.
                      </p>
                    )}
                  </div>
                )}

                {customizeTab === 'background' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-[#18142C]">
                        <ImageIcon className="h-3.5 w-3.5 text-[#7C3AED]" />
                        <span>Separate Front &amp; Back Backgrounds &amp; Card Borders</span>
                      </div>
                      <span
                        title="Recommended size: 1082 × 709 px (Landscape) or 709 × 1082 px (Vertical) at 300 DPI, max 5 MB."
                        className="inline-flex items-center gap-1 text-[11px] text-slate-500 cursor-help"
                      >
                        <Info className="h-3.5 w-3.5 text-[#7C3AED]" />
                        <span>300 DPI guide</span>
                      </span>
                    </div>

                    {/* Front Card Design / Background & Border Box */}
                    <div
                      className={`p-3.5 rounded-xl border space-y-3 ${
                        activeSide === 'front' ? 'border-[#7C3AED] bg-[#F3EEFF]/40' : 'border-[#E9E4F5] bg-[#FAF9FE]/60'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-bold text-[#18142C]">Front Card Background &amp; Border</span>
                        <div className="flex items-center gap-1.5">
                          {frontDesign.backgroundImageUrl && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                              Image Uploaded
                            </span>
                          )}
                          {renderElementHistoryButtons('front', { kind: 'background' }, 'front background', true)}
                        </div>
                      </div>
                      <ColorPaletteField
                        label="Front Background Color"
                        compact
                        value={frontDesign.backgroundColor}
                        onChange={(hex) =>
                          updateBackgroundForSide('front', { backgroundColor: hex, gradientTo: '' }, false)
                        }
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-[#7C3AED] bg-white text-[#7C3AED] rounded-lg text-xs font-semibold cursor-pointer hover:bg-[#F3EEFF]">
                          <Upload className="h-3.5 w-3.5" />
                          <span>{frontDesign.backgroundImageUrl ? 'Replace Front Image' : 'Upload Front Image'}</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => handleBackgroundUploadForSide('front', e)}
                          />
                        </label>
                        {frontDesign.backgroundImageUrl && (
                          <button
                            type="button"
                            onClick={() => updateBackgroundForSide('front', { backgroundImageUrl: '' }, false)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-rose-200 bg-white text-rose-600 rounded-lg text-xs font-medium hover:bg-rose-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>Remove</span>
                          </button>
                        )}
                      </div>
                      <div className="pt-2 border-t border-[#E9E4F5]/80 space-y-2">
                        <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={Boolean(frontDesign.showBorder)}
                            onChange={(e) =>
                              updateBackgroundForSide(
                                'front',
                                {
                                  showBorder: e.target.checked,
                                  borderColor: frontDesign.borderColor || '#D4AF37',
                                  borderWidthPx: frontDesign.borderWidthPx || 2,
                                },
                                false
                              )
                            }
                            className="h-4 w-4 accent-[#7C3AED]"
                          />
                          <Palette className="h-3.5 w-3.5 text-[#7C3AED]" />
                          <span>Show Card Outer Border (Front)</span>
                        </label>
                        {frontDesign.showBorder && (
                          <div className="space-y-2 pl-1">
                            <ColorPaletteField
                              label="Front Border Color"
                              compact
                              value={frontDesign.borderColor || '#D4AF37'}
                              onChange={(hex) =>
                                updateBackgroundForSide('front', { borderColor: hex }, false)
                              }
                            />
                            <div>
                              <label className="block text-[11px] text-slate-600">
                                Border Thickness: {frontDesign.borderWidthPx || 2} px
                              </label>
                              <input
                                type="range"
                                min={1}
                                max={6}
                                value={frontDesign.borderWidthPx || 2}
                                onChange={(e) =>
                                  updateBackgroundForSide('front', { borderWidthPx: Number(e.target.value) }, true)
                                }
                                className="w-full"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Back Card Design / Background & Border Box */}
                    <div
                      className={`p-3.5 rounded-xl border space-y-3 ${
                        activeSide === 'back' ? 'border-emerald-600 bg-emerald-50/40' : 'border-[#E9E4F5] bg-[#FAF9FE]/60'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-bold text-[#18142C]">Back Card Background &amp; Border</span>
                        <div className="flex items-center gap-1.5">
                          {backDesign.backgroundImageUrl && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                              Image Uploaded
                            </span>
                          )}
                          {renderElementHistoryButtons('back', { kind: 'background' }, 'back background', true)}
                        </div>
                      </div>
                      <ColorPaletteField
                        label="Back Background Color"
                        compact
                        value={backDesign.backgroundColor}
                        onChange={(hex) =>
                          updateBackgroundForSide('back', { backgroundColor: hex, gradientTo: '' }, false)
                        }
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-emerald-600 bg-white text-emerald-700 rounded-lg text-xs font-semibold cursor-pointer hover:bg-emerald-50">
                          <Upload className="h-3.5 w-3.5" />
                          <span>{backDesign.backgroundImageUrl ? 'Replace Back Image' : 'Upload Back Image'}</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => handleBackgroundUploadForSide('back', e)}
                          />
                        </label>
                        {backDesign.backgroundImageUrl && (
                          <button
                            type="button"
                            onClick={() => updateBackgroundForSide('back', { backgroundImageUrl: '' }, false)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-rose-200 bg-white text-rose-600 rounded-lg text-xs font-medium hover:bg-rose-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>Remove</span>
                          </button>
                        )}
                      </div>
                      <div className="pt-2 border-t border-[#E9E4F5]/80 space-y-2">
                        <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={Boolean(backDesign.showBorder)}
                            onChange={(e) =>
                              updateBackgroundForSide(
                                'back',
                                {
                                  showBorder: e.target.checked,
                                  borderColor: backDesign.borderColor || '#D4AF37',
                                  borderWidthPx: backDesign.borderWidthPx || 2,
                                },
                                false
                              )
                            }
                            className="h-4 w-4 accent-emerald-600"
                          />
                          <Palette className="h-3.5 w-3.5 text-emerald-700" />
                          <span>Show Card Outer Border (Back)</span>
                        </label>
                        {backDesign.showBorder && (
                          <div className="space-y-2 pl-1">
                            <ColorPaletteField
                              label="Back Border Color"
                              compact
                              value={backDesign.borderColor || '#D4AF37'}
                              onChange={(hex) =>
                                updateBackgroundForSide('back', { borderColor: hex }, false)
                              }
                            />
                            <div>
                              <label className="block text-[11px] text-slate-600">
                                Border Thickness: {backDesign.borderWidthPx || 2} px
                              </label>
                              <input
                                type="range"
                                min={1}
                                max={6}
                                value={backDesign.borderWidthPx || 2}
                                onChange={(e) =>
                                  updateBackgroundForSide('back', { borderWidthPx: Number(e.target.value) }, true)
                                }
                                className="w-full"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {customizeTab === 'media' && (
                  <div className="space-y-3">
                    {/* Profile Photo Settings */}
                    <div className="p-3.5 rounded-xl border border-[#E9E4F5] bg-[#FAF9FE]/60 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-semibold text-[#18142C] flex items-center gap-1.5">
                          <UserCircle2 className="h-3.5 w-3.5 text-[#7C3AED]" />
                          <span>Profile Photo (Drag on Card)</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {renderElementHistoryButtons(activeSide, { kind: 'avatar' }, 'profile photo', true)}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {pi?.photoDataUrl && (
                          <button
                            type="button"
                            onClick={() =>
                              updateAvatarSide({
                                avatarDataUrl: pi.photoDataUrl,
                                avatarShape: currentSide.avatarShape || 'square',
                                showAvatar: true,
                              })
                            }
                            className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-medium hover:bg-[#FAF9FE]"
                          >
                            Use Profile Photo
                          </button>
                        )}
                        <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-medium cursor-pointer hover:bg-[#FAF9FE]">
                          <Upload className="h-3.5 w-3.5" />
                          <span>Upload Photo</span>
                          <input type="file" accept="image/*" className="hidden" onChange={handleStudioPhotoUpload} />
                        </label>
                        {(currentSide.avatarDataUrl || pi?.photoDataUrl) && (
                          <button
                            type="button"
                            onClick={() => setPhotoCropSource(currentSide.avatarDataUrl || pi?.photoDataUrl || null)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-[#F3EEFF] border border-[#DDD6FE] text-[#7C3AED] rounded-lg text-xs font-semibold hover:bg-[#EAE3FF]"
                          >
                            <Crop className="h-3.5 w-3.5" />
                            <span>Crop / Resize Photo</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            updateAvatarSide({
                              avatarDataUrl: currentSide.avatarDataUrl || pi?.photoDataUrl || '',
                              avatarShape: currentSide.avatarShape || 'square',
                              showAvatar: !currentSide.showAvatar,
                            })
                          }
                          className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-medium hover:bg-[#FAF9FE]"
                        >
                          {currentSide.showAvatar ? 'Hide Photo Frame' : 'Show Photo Frame'}
                        </button>
                      </div>

                      {currentSide.showAvatar && (
                        <div className="space-y-2.5 pt-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[11px] font-medium text-slate-600">Photo Frame Shape:</span>
                            <div className="flex items-center gap-1 bg-white border border-slate-300 rounded-lg p-0.5">
                              {(['square', 'rounded', 'circle'] as const).map((shp) => (
                                <button
                                  key={shp}
                                  type="button"
                                  onClick={() => updateAvatarSide({ avatarShape: shp })}
                                  className={`px-2.5 py-1 rounded text-[11px] font-semibold capitalize ${
                                    (currentSide.avatarShape || 'square') === shp
                                      ? 'bg-[#18142C] text-white'
                                      : 'text-slate-600 hover:bg-slate-100'
                                  }`}
                                >
                                  {shp}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-600">
                              Photo Size ({currentSide.avatarSizeMm || 13} mm)
                            </label>
                            <input
                              type="range"
                              min={8}
                              max={54}
                              value={currentSide.avatarSizeMm || 13}
                              onChange={(e) => resizeAvatarSizeMm(Number(e.target.value))}
                              className="w-full"
                            />
                          </div>
                          <div className="space-y-1.5 pt-1 border-t border-[#E9E4F5]/70">
                            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={Boolean(currentSide.showAvatarBorder)}
                                onChange={(e) => updateAvatarSide({ showAvatarBorder: e.target.checked })}
                                className="h-3.5 w-3.5 accent-[#7C3AED]"
                              />
                              <span>Show Photo Frame Border (Uncheck for borderless transparent PNGs)</span>
                            </label>
                            {currentSide.showAvatarBorder && (
                              <ColorPaletteField
                                label="Photo Border Color"
                                compact
                                value={currentSide.avatarBorderColor || '#FFFFFF'}
                                onChange={(hex) => updateAvatarSide({ avatarBorderColor: hex })}
                              />
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Company / Brand Logo Settings */}
                    <div className="p-3.5 rounded-xl border border-[#E9E4F5] bg-[#FAF9FE]/60 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[#18142C]">Company / Brand Logo</span>
                        <div className="flex items-center gap-1.5">
                          {renderElementHistoryButtons(activeSide, { kind: 'logo' }, 'company logo', true)}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-medium cursor-pointer hover:bg-[#FAF9FE]">
                          <Upload className="h-3.5 w-3.5" />
                          <span>{currentSide.logoDataUrl ? 'Replace Logo' : 'Upload Logo'}</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={async (e) => {
                              const f = e.target.files?.[0];
                              e.target.value = '';
                              if (!f) return;
                              try {
                                const dataUrl = await compressImageFileToDataUrl(f, {
                                  maxWidth: 480,
                                  maxHeight: 480,
                                  maxChars: 140_000,
                                  preserveAlpha: true,
                                });
                                updateLogoSide({ logoDataUrl: dataUrl });
                              } catch {
                                notify('Logo upload failed', 'Could not read logo image.', 'error');
                              }
                            }}
                          />
                        </label>
                        {currentSide.logoDataUrl && (
                          <button
                            type="button"
                            onClick={() => updateLogoSide({ logoDataUrl: '' })}
                            className="px-2.5 py-1.5 bg-white border border-rose-200 text-rose-600 rounded-lg text-xs font-medium"
                          >
                            Remove Logo
                          </button>
                        )}
                      </div>
                      {currentSide.logoDataUrl && (
                        <div>
                          <label className="block text-[11px] text-slate-600">
                            Logo Width ({currentSide.logoWidthMm || 14} mm)
                          </label>
                          <input
                            type="range"
                            min={8}
                            max={54}
                            value={currentSide.logoWidthMm || 14}
                            onChange={(e) => resizeLogoWidthMm(Number(e.target.value))}
                            className="w-full"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {customizeTab === 'qr' && (
                  <div className="space-y-3">
                    {/* QR Slot Placement & Size */}
                    <div className="p-3.5 rounded-xl border border-[#E9E4F5] bg-[#FAF9FE]/60 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[#18142C]">Predefined QR Code Area</span>
                        <div className="flex flex-wrap items-center gap-2">
                          {renderElementHistoryButtons(activeSide, { kind: 'qr' }, 'QR code slot', true)}
                          <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                            <input
                              type="checkbox"
                              checked={currentSide.showQrSlot}
                              onChange={(e) => updateQrSide({ showQrSlot: e.target.checked })}
                            />
                            <span>Show on {activeSide}</span>
                          </label>
                        </div>
                      </div>
                      {currentSide.showQrSlot && (
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-[11px] text-slate-600">Size ({currentSide.qrSizeMm}mm)</label>
                            <input
                              type="range"
                              min={12}
                              max={28}
                              value={currentSide.qrSizeMm}
                              onChange={(e) => updateQrSide({ qrSizeMm: Number(e.target.value) }, true)}
                              className="w-full"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-600">X ({currentSide.qrSlotX}%)</label>
                            <input
                              type="range"
                              min={4}
                              max={80}
                              value={currentSide.qrSlotX}
                              onChange={(e) => updateQrSide({ qrSlotX: Number(e.target.value) }, true)}
                              className="w-full"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-600">Y ({currentSide.qrSlotY}%)</label>
                            <input
                              type="range"
                              min={4}
                              max={76}
                              value={currentSide.qrSlotY}
                              onChange={(e) => updateQrSide({ qrSlotY: Number(e.target.value) }, true)}
                              className="w-full"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* SMART Symbol Settings (Full Position & Size Control) */}
                    <div className="p-3.5 rounded-xl border border-[#E9E4F5] bg-[#FAF9FE]/60 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#18142C] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={currentSide.showNfcIcon}
                            onChange={(e) => updateNfcSide({ showNfcIcon: e.target.checked })}
                          />
                          <Wifi className="h-3.5 w-3.5 text-[#7C3AED] rotate-90" />
                          <span>Show SMART Wave Icon (Draggable)</span>
                        </label>
                        <div className="flex items-center gap-1.5">
                          {renderElementHistoryButtons(activeSide, { kind: 'nfc' }, 'SMART icon', true)}
                        </div>
                      </div>
                      {currentSide.showNfcIcon && (
                        <ColorPaletteField
                          label="SMART Wave Icon Color"
                          compact
                          value={currentSide.nfcIconColor || '#38BDF8'}
                          onChange={(hex) => updateNfcSide({ nfcIconColor: hex })}
                        />
                      )}
                      {currentSide.showNfcIcon && (
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-[11px] text-slate-600">
                              Size ({currentSide.nfcSizeMm || 6}mm)
                            </label>
                            <input
                              type="range"
                              min={3}
                              max={14}
                              step={0.5}
                              value={currentSide.nfcSizeMm || 6}
                              onChange={(e) => updateNfcSide({ nfcSizeMm: Number(e.target.value) }, true)}
                              className="w-full"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-600">X ({currentSide.nfcX ?? 88}%)</label>
                            <input
                              type="range"
                              min={4}
                              max={92}
                              value={currentSide.nfcX ?? 88}
                              onChange={(e) => updateNfcSide({ nfcX: Number(e.target.value) }, true)}
                              className="w-full"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-600">Y ({currentSide.nfcY ?? 12}%)</label>
                            <input
                              type="range"
                              min={4}
                              max={90}
                              value={currentSide.nfcY ?? 12}
                              onChange={(e) => updateNfcSide({ nfcY: Number(e.target.value) }, true)}
                              className="w-full"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Card Edition & Live Tiered Pricing Gate */}
            <div className="pt-5 border-t border-[#E9E4F5] space-y-4">
              {studioPricing.pricingMode === 'fixed_pack' ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-[#18142C]">{studioPricing.editionLabel}</span>
                    <span className="font-mono text-sm font-bold text-[#7C3AED] tabular-nums">
                      ₹{studioPricing.unitPriceInr}
                    </span>
                  </div>
                  <p className="text-[11px] font-medium text-amber-900">
                    {studioPricing.packNote}
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-[#E9E4F5] bg-[#FAF9FE]/80 p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-[#18142C]">
                      Select Card Technology ({studioPricing.designTier === 'minimal' ? 'Minimal' : 'Designer'} Series)
                    </span>
                    <span className="font-mono text-xs font-bold text-[#7C3AED] tabular-nums">
                      ₹{studioPricing.unitPriceInr}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleSelectTechnology('qr_only')}
                      className={`p-2.5 rounded-lg border text-left transition-colors ${
                        cardTechnology === 'qr_only'
                          ? 'border-[#7C3AED] bg-white ring-1 ring-[#7C3AED]'
                          : 'border-[#E9E4F5] bg-white/70 hover:bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs font-bold text-[#18142C]">
                        <span>QR Code Only</span>
                        <span className="font-mono text-[#7C3AED]">₹{studioPricing.qrOnlyPriceInr}</span>
                      </div>
                      <div className="text-[10.5px] text-slate-500 mt-0.5">
                        {studioPricing.designTier === 'minimal' ? 'Basic Minimal ₹499' : 'Designer QR ₹599'}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectTechnology('qr_smart')}
                      className={`p-2.5 rounded-lg border text-left transition-colors ${
                        cardTechnology === 'qr_smart'
                          ? 'border-[#7C3AED] bg-white ring-1 ring-[#7C3AED]'
                          : 'border-[#E9E4F5] bg-white/70 hover:bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs font-bold text-[#18142C]">
                        <span>QR + Smart Card</span>
                        <span className="font-mono text-[#7C3AED]">₹{studioPricing.qrSmartPriceInr}</span>
                      </div>
                      <div className="text-[10.5px] text-slate-500 mt-0.5">
                        {studioPricing.designTier === 'minimal' ? 'Minimal Smart ₹999' : 'Designer Smart ₹1,499'}
                      </div>
                    </button>
                  </div>
                </div>
              )}

              <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={approvalChecked}
                  onChange={(e) => setApprovalChecked(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#7C3AED]"
                />
                <span>
                  I approve this design and confirm that all details are correct.
                </span>
              </label>

              <div className="flex flex-col sm:flex-row gap-2.5">
                <button
                  type="button"
                  onClick={() => setPreviewModalOpen(true)}
                  className="sm:w-1/3 py-3 rounded-xl border border-slate-300 bg-white hover:bg-[#FAF9FE] text-slate-800 text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span>Preview</span>
                </button>
                <button
                  type="button"
                  disabled={saving || !approvalChecked}
                  onClick={handleApproveAndCheckout}
                  className="flex-1 py-3 rounded-xl bg-[#18142C] hover:bg-[#2A2048] text-white text-sm font-semibold disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Locking Approved Version...' : `Approve & Checkout · ₹${studioPricing.unitPriceInr}`}
                </button>
              </div>

              {savedDesigns.length > 0 && (
                <div className="pt-3 border-t border-[#F0ECF9]">
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">
                    Saved Customized Designs ({savedDesigns.length})
                  </label>
                  <select
                    value=""
                    onChange={(e) => {
                      const found = savedDesigns.find((d) => d.designId === e.target.value);
                      if (!found) return;
                      const matchedTpl = templates.find((t) => t.templateId === found.templateId) || templates[0];
                      if (matchedTpl) setSelectedTpl(matchedTpl);
                      setCardTechnology(
                        found.cardTechnology || (found.frontDesign.showNfcIcon ? 'qr_smart' : 'qr_only')
                      );
                      setOrientation(found.cardOrientation || 'landscape');
                      setFrontDesign(refreshUneditedSideWithProfileInfo(found.frontDesign, effectiveProfileInfo));
                      setBackDesign(refreshUneditedSideWithProfileInfo(found.backDesign, effectiveProfileInfo));
                      setMode('custom');
                      clearAllElementHistory();
                      notify('Loaded saved design', `Restored ${found.approved ? 'approved' : 'draft'} layout.`, 'info');
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                  >
                    <option value="">Load a previously saved customized design...</option>
                    {savedDesigns.map((d, idx) => (
                      <option key={d.designId} value={d.designId}>
                        Design #{savedDesigns.length - idx} · {d.dimensions} ({d.approved ? 'Approved' : 'Draft'})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <CardDesignPreviewModal
        open={previewModalOpen}
        onClose={() => setPreviewModalOpen(false)}
        title="Customized Card Design Preview"
        subtitle={`${selectedTpl.name} · ${orientation === 'vertical' ? '54.0 × 85.6 mm Vertical' : '85.6 × 54.0 mm Landscape'}`}
        frontDesign={frontDesign}
        backDesign={backDesign}
        orientation={orientation}
        personalInfo={effectiveProfileInfo}
      />

      <ProfilePhotoEditorModal
        open={Boolean(photoCropSource)}
        imageSrc={photoCropSource || ''}
        title="Crop & Frame Card Photo"
        frameShape={currentSide.avatarShape || 'square'}
        onClose={() => setPhotoCropSource(null)}
        onSave={(croppedDataUrl) => {
          updateAvatarSide(
            {
              avatarDataUrl: croppedDataUrl,
              avatarShape: currentSide.avatarShape || 'square',
              showAvatar: true,
            },
            false
          );
          setPhotoCropSource(null);
          notify('Card photo updated', 'Framed photo applied cleanly to your card design.', 'success');
        }}
      />

      {resetDesignModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-design-modal-title"
        >
          <div className="w-full max-w-md bg-white rounded-2xl border border-[#E9E4F5] shadow-2xl overflow-hidden">
            <div className="px-5 py-4 bg-rose-50 border-b border-rose-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-rose-900">
                <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
                <h3 id="reset-design-modal-title" className="font-display font-bold text-sm">
                  Reset Entire Card Design?
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setResetDesignModalOpen(false)}
                className="p-1 rounded-lg text-rose-700 hover:bg-rose-100"
                aria-label="Close confirmation dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-xs leading-relaxed text-slate-700">
                All settings across both <strong>Front</strong> and <strong>Back</strong> sides — including custom colors,
                fonts, sizes, shapes, uploaded backgrounds, logos, and positions — will reset to the{' '}
                <strong>{selectedTpl.name}</strong> template defaults.
              </p>
              <p className="text-[11px] text-slate-500">
                If you only want to revert one element, cancel this dialog and use the <strong>Undo</strong> or{' '}
                <strong>Reset</strong> button on that selected element instead.
              </p>
              <div className="flex items-center justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setResetDesignModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-[#FAF9FE]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleLoadDefaultSettings}
                  className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold"
                >
                  Reset All Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </PortalLayout>
  );
};

// 7. Checkout & Server-Verified Razorpay Payment Flow
export const CustomerCheckoutPage: React.FC = () => {
  const { userRecord, appSettings } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const designId = searchParams.get('designId');

  const [design, setDesign] = useState<CardDesignRecord | null>(null);
  const [profile, setProfile] = useState<ProfileRecord | null>(null);
  const [template, setTemplate] = useState<CardTemplateRecord>(
    DEFAULT_CARD_TEMPLATES.find((t) => t.isDefault) || DEFAULT_CARD_TEMPLATES[0]
  );
  const [quantity, setQuantity] = useState(1);
  const [pendingOrder, setPendingOrder] = useState<{
    orderId: string;
    orderNumber: string;
    quantity: number;
  } | null>(null);
  const [processing, setProcessing] = useState(false);
  const [previewSide, setPreviewSide] = useState<'front' | 'back'>('front');
  const [checkoutPreviewOpen, setCheckoutPreviewOpen] = useState(false);

  const [shipping, setShipping] = useState({
    fullName: '',
    mobile: '',
    email: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: 'Maharashtra',
    pinCode: '',
    country: 'India',
  });

  const allGatewayConfigs: PaymentGatewayConfig[] = PAYMENT_GATEWAY_ORDER.map(
    (id) => appSettings.paymentGateways?.[id] || DEFAULT_PAYMENT_GATEWAYS[id]
  );
  const razorpayConfig =
    appSettings.paymentGateways?.razorpay || DEFAULT_PAYMENT_GATEWAYS.razorpay;
  const activeGatewayConfig = razorpayConfig.enabled !== false ? razorpayConfig : null;

  useEffect(() => {
    if (!userRecord) return;
    Promise.all([
      designId ? getCardDesignById(designId) : getUserDesigns(userRecord.uid).then((d) => d[0] || null),
      getUserProfiles(userRecord.uid),
      getCardTemplates(true),
    ]).then(async ([des, profs, tpls]) => {
      setDesign(des);
      const prof = profs.find((p) => p.profileId === des?.profileId) || profs[0] || null;
      setProfile(prof);
      if (prof) {
        setShipping((prev) => ({
          ...prev,
          fullName: prev.fullName || prof.personalInformation.fullName || userRecord.displayName || '',
          mobile: prev.mobile || prof.personalInformation.mobile || '',
          email: prev.email || prof.personalInformation.email || userRecord.email || '',
          addressLine1: prev.addressLine1 || prof.personalInformation.businessAddress || '',
          city: prev.city || prof.personalInformation.city || '',
          state: prof.personalInformation.state || 'Maharashtra',
          pinCode: prev.pinCode || prof.personalInformation.pinCode || '',
        }));
      }
      const foundTpl = tpls.find((t) => t.templateId === des?.templateId) || tpls.find((t) => t.isDefault) || tpls[0];
      if (foundTpl) setTemplate(foundTpl);

      if (des?.locked && des.orderId) {
        const existingOrd = await getOrderById(des.orderId).catch(() => null);
        if (existingOrd && existingOrd.uid === userRecord.uid) {
          if (existingOrd.paymentStatus === 'Verified' || existingOrd.paymentStatus === 'Completed') {
            navigate(`/dashboard/orders/${existingOrd.orderId}`, { replace: true });
            return;
          }
          if (
            (existingOrd.paymentStatus === 'Pending' || existingOrd.paymentStatus === 'Failed') &&
            existingOrd.orderStatus === 'Awaiting Payment'
          ) {
            setQuantity(existingOrd.quantity || 1);
            setPendingOrder({
              orderId: existingOrd.orderId,
              orderNumber: existingOrd.orderNumber,
              quantity: existingOrd.quantity || 1,
            });
          }
        }
      }
    });
  }, [userRecord, designId, navigate]);

  const checkoutPricing = resolveCardPricing(
    template,
    design?.cardTechnology || (design?.frontDesign?.showNfcIcon ? 'qr_smart' : 'qr_only')
  );
  const unitPrice = checkoutPricing.unitPriceInr || appSettings.baseCardPriceInr || 999;
  const subtotal = unitPrice * quantity;
  const tax = Math.round((subtotal * (appSettings.taxRatePercent || 18)) / 100);
  const shippingFee = appSettings.shippingFeeInr ?? 99;
  const total = subtotal + tax + shippingFee;

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userRecord || !design || !profile) return;
    if (!activeGatewayConfig) {
      notify('Razorpay disabled', 'Razorpay checkout is currently disabled by the administrator.', 'error');
      return;
    }

    const cleanPhone = shipping.mobile.replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      notify('Invalid mobile number', 'Please enter a valid 10-digit Indian mobile number.', 'error');
      return;
    }
    if (!/^\d{6}$/.test(shipping.pinCode.trim())) {
      notify('Invalid PIN code', 'Please enter a valid 6-digit Indian PIN code.', 'error');
      return;
    }

    setProcessing(true);
    try {
      let orderId: string;
      let orderNumber: string;

      if (pendingOrder && pendingOrder.quantity === quantity) {
        orderId = pendingOrder.orderId;
        orderNumber = pendingOrder.orderNumber;
      } else {
        orderId = `ord_${Date.now()}`;
        orderNumber = `TNX-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;
        await createPendingOrder({
          orderId,
          orderNumber,
          uid: userRecord.uid,
          profileId: profile.profileId,
          profileSlug: profile.slug,
          designId: design.designId,
          quantity,
          cardType: checkoutPricing.packNote
            ? `${template.name} (${checkoutPricing.packNote})`
            : `${template.name} (${checkoutPricing.editionLabel})`,
          subtotal,
          tax,
          shipping: shippingFee,
          total,
          shippingAddress: shipping,
        });
        setPendingOrder({ orderId, orderNumber, quantity });
      }

      const gwOrder = await createPaymentOrder(orderId);

      await new Promise<void>((resolve, reject) => {
        const existingScript = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
        if (existingScript) {
          resolve();
          return;
        }
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load Razorpay Checkout SDK.'));
        document.body.appendChild(script);
      });

      const RazorpayCtor = (window as unknown as {
        Razorpay?: new (opts: Record<string, unknown>) => { open: () => void; on: (ev: string, cb: (r: { error?: { description?: string } }) => void) => void };
      }).Razorpay;

      if (!RazorpayCtor) {
        throw new Error('Razorpay Checkout SDK failed to initialize.');
      }

      const rzpResult = await new Promise<{
        razorpay_order_id?: string;
        razorpay_payment_id: string;
        razorpay_signature: string;
      }>((resolve, reject) => {
        const rzp = new RazorpayCtor({
          key: gwOrder.keyId,
          amount: gwOrder.amountPaise,
          currency: gwOrder.currency || 'INR',
          name: 'TapNex',
          description: `TapNex Smart Card Order ${orderNumber}`,
          order_id: gwOrder.gatewayOrderId,
          prefill: {
            name: shipping.fullName,
            email: shipping.email,
            contact: cleanPhone,
          },
          theme: { color: '#7C3AED' },
          handler: (response: {
            razorpay_order_id?: string;
            razorpay_payment_id: string;
            razorpay_signature: string;
          }) => resolve(response),
          modal: { ondismiss: () => reject(new Error('Payment popup closed before completion.')) },
        });
        rzp.on('payment.failed', (resp) => reject(new Error(resp?.error?.description || 'Razorpay payment failed.')));
        rzp.open();
      });

      const verification = await verifyPayment({
        orderId,
        gatewayOrderId: rzpResult.razorpay_order_id || gwOrder.gatewayOrderId,
        gatewayPaymentId: rzpResult.razorpay_payment_id,
        signature: rzpResult.razorpay_signature,
      });

      if (!verification.verified) {
        throw new Error('Server payment verification failed.');
      }

      const eligibleSlug = sanitizeSlug(profile.slug || '');
      if (eligibleSlug.length >= 3 && eligibleSlug !== 'undefined') {
        try {
          await generatePurchasedQr(orderId);
        } catch (qrErr) {
          notify(
            'Payment verified — QR generation pending',
            qrErr instanceof Error
              ? `Payment succeeded, but QR artwork generation could not finish yet: ${qrErr.message}`
              : 'Payment succeeded, and your QR code will be prepared shortly.',
            'info'
          );
        }
      }

      const verifiedAmountInr = Math.round((verification.amountPaise || gwOrder.amountPaise) / 100);
      try {
        const emailRes = await sendAndLogTransactionalEmail({
          orderId,
          uid: userRecord.uid,
          to: shipping.email,
          templateId: 'order_confirmation',
          variables: {
            ORDER_NUMBER: orderNumber,
            AMOUNT: String(verifiedAmountInr),
            CUSTOMER_NAME: shipping.fullName,
          },
        });
        if (!emailRes.delivered) {
          const reason = formatEmailDeliveryFailureReason(emailRes);
          console.warn('Order confirmation email not delivered:', reason || emailRes);
          notify(
            'Order confirmed — confirmation email pending',
            reason || 'Your order is confirmed, but confirmation email delivery failed.',
            'info'
          );
        }
      } catch (emailErr) {
        console.error('Order confirmation email failed after verified payment:', emailErr);
      }

      notify(
        'Your Smart Business Card Order Is Confirmed!',
        `Order ${orderNumber} verified via Razorpay. Expected delivery: 10–15 days within India.`,
        'success'
      );
      navigate(`/dashboard/orders/${orderId}`);
    } catch (err) {
      notify('Payment failed', err instanceof Error ? err.message : 'Unable to complete checkout.', 'error');
    } finally {
      setProcessing(false);
    }
  };

  if (!design || !profile) {
    return (
      <PortalLayout portal="customer" title="Checkout">
        <div className="bg-white border border-[#E9E4F5] rounded-2xl p-8 text-center">
          <h2 className="font-display font-bold text-lg text-[#18142C]">No Approved Card Design Found</h2>
          <p className="mt-2 text-sm text-slate-600">
            Please customize and approve your 85.6 × 54 mm business card in the Design Studio first.
          </p>
          <Link
            to="/dashboard/card-design"
            className="mt-5 inline-block px-5 py-2.5 bg-[#18142C] text-white text-sm font-semibold rounded-xl"
          >
            Open Design Studio
          </Link>
        </div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout portal="customer" title="Order Checkout & Payment">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form onSubmit={handleCheckout} className="lg:col-span-7 bg-white border border-[#E9E4F5] rounded-2xl p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-[#F0ECF9] pb-3">
            <h2 className="font-display font-bold text-base text-[#18142C]">Shipping Details (India)</h2>
            <span className="text-xs font-mono text-slate-500">10–15 Days Delivery</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Recipient Full Name *</label>
              <input
                type="text"
                required
                value={shipping.fullName}
                onChange={(e) => setShipping({ ...shipping, fullName: e.target.value })}
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Indian Mobile Number (10 digits) *</label>
              <input
                type="tel"
                required
                value={shipping.mobile}
                onChange={(e) => setShipping({ ...shipping, mobile: e.target.value })}
                placeholder="9876543210"
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm font-mono"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">Email for Confirmation & Tracking *</label>
              <input
                type="email"
                required
                value={shipping.email}
                onChange={(e) => setShipping({ ...shipping, email: e.target.value })}
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">Address Line 1 *</label>
              <input
                type="text"
                required
                value={shipping.addressLine1}
                onChange={(e) => setShipping({ ...shipping, addressLine1: e.target.value })}
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">Address Line 2</label>
              <input
                type="text"
                value={shipping.addressLine2}
                onChange={(e) => setShipping({ ...shipping, addressLine2: e.target.value })}
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">City *</label>
              <input
                type="text"
                required
                value={shipping.city}
                onChange={(e) => setShipping({ ...shipping, city: e.target.value })}
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">State *</label>
              <select
                value={shipping.state}
                onChange={(e) => setShipping({ ...shipping, state: e.target.value })}
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm bg-white"
              >
                {INDIAN_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">PIN Code (6 digits) *</label>
              <input
                type="text"
                required
                maxLength={6}
                value={shipping.pinCode}
                onChange={(e) => setShipping({ ...shipping, pinCode: e.target.value.replace(/\D/g, '') })}
                placeholder="400001"
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Country</label>
              <input
                type="text"
                readOnly
                value="India"
                className="w-full px-3.5 py-2.5 border border-[#E9E4F5] bg-[#FAF9FE] rounded-lg text-sm text-slate-600"
              />
            </div>
          </div>

          {/* Payment Method (Razorpay Only) */}
          <div className="pt-4 border-t border-[#E9E4F5] space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-bold text-sm text-[#18142C]">Payment Method</h3>
              <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-medium">
                <ShieldCheck className="h-4 w-4" />
                <span>Server Verified</span>
              </span>
            </div>

            {!activeGatewayConfig ? (
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                Razorpay checkout is currently disabled by the administrator. Please contact support before placing an order.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {allGatewayConfigs.map((gw) => {
                  const isRazorpay = gw.id === 'razorpay';
                  return (
                    <button
                      key={gw.id}
                      type="button"
                      disabled={!isRazorpay}
                      aria-disabled={!isRazorpay}
                      className={`p-3 rounded-xl border text-left transition-colors flex items-start justify-between gap-2 ${
                        isRazorpay
                          ? 'border-[#7C3AED] bg-[#F3EEFF]/80 ring-1 ring-[#7C3AED]'
                          : 'border-[#E9E4F5] bg-[#FAF9FE] opacity-55 cursor-not-allowed'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="font-display font-bold text-xs text-[#18142C] flex flex-wrap items-center gap-1.5">
                          <span>{gw.label}</span>
                          <span
                            className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${
                              isRazorpay
                                ? 'bg-[#F3EEFF] text-[#7C3AED]'
                                : 'bg-slate-200 text-slate-600'
                            }`}
                          >
                            {isRazorpay ? 'Active' : 'Temporarily Unavailable'}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">
                          {isRazorpay ? gw.description : 'Temporarily disabled pending server verification'}
                        </div>
                      </div>
                      <span
                        className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 mt-0.5 ${
                          isRazorpay ? 'border-[#7C3AED] bg-[#7C3AED] text-white' : 'border-slate-300'
                        }`}
                      >
                        {isRazorpay && <Check className="h-2.5 w-2.5" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <button
              type="submit"
              disabled={processing || !activeGatewayConfig}
              className="w-full py-3.5 rounded-xl bg-[#18142C] hover:bg-[#2A2048] text-white text-sm font-semibold disabled:opacity-50"
            >
              {processing
                ? 'Verifying Payment & Preparing Order...'
                : activeGatewayConfig
                  ? `Pay ₹${total} via Razorpay`
                  : 'Payment Unavailable'}
            </button>
          </div>
        </form>

        {/* Order Summary & Card Preview */}
        <div className="lg:col-span-5 space-y-5">
          <div className="bg-white border border-[#E9E4F5] rounded-2xl p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display font-bold text-base text-[#18142C]">Approved Card Summary</h3>
              <div className="flex items-center gap-1.5">
                <div className="flex p-0.5 bg-slate-100 rounded-lg text-[11px]">
                  <button
                    type="button"
                    onClick={() => setPreviewSide('front')}
                    className={`px-2 py-1 rounded font-semibold ${previewSide === 'front' ? 'bg-white text-[#18142C] shadow-xs' : 'text-slate-600'}`}
                  >
                    Front
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewSide('back')}
                    className={`px-2 py-1 rounded font-semibold ${previewSide === 'back' ? 'bg-white text-[#18142C] shadow-xs' : 'text-slate-600'}`}
                  >
                    Back
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setCheckoutPreviewOpen(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#E9E4F5] text-[11px] font-semibold text-[#7C3AED] hover:bg-[#F3EEFF]"
                >
                  <Eye className="h-3 w-3" />
                  <span>Full Preview</span>
                </button>
              </div>
            </div>
            <CardCanvasPreview
              side={previewSide === 'front' ? design.frontDesign : design.backDesign}
              orientation={design.cardOrientation}
              personalInfo={buildEffectiveProfileInfo(profile, userRecord)}
            />
            <div className="flex items-center justify-between pt-3 border-t border-[#F0ECF9]">
              <span className="text-sm text-slate-600">Quantity</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={Boolean(pendingOrder) || processing}
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className="w-8 h-8 rounded border border-slate-300 font-bold disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  -
                </button>
                <span className="font-mono w-8 text-center font-semibold tabular-nums">{quantity}</span>
                <button
                  type="button"
                  disabled={Boolean(pendingOrder) || processing}
                  onClick={() => setQuantity((q) => Math.min(100, q + 1))}
                  className="w-8 h-8 rounded border border-slate-300 font-bold disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  +
                </button>
              </div>
            </div>
            {pendingOrder && (
              <p className="text-[11px] text-slate-500">
                Order {pendingOrder.orderNumber} initialized. Complete Razorpay payment to confirm.
              </p>
            )}
            <div className="space-y-2 text-sm border-t border-[#F0ECF9] pt-3">
              <div className="flex justify-between text-slate-600 gap-2">
                <div>
                  <div>{template.name} ({checkoutPricing.editionLabel})</div>
                  {checkoutPricing.packNote && (
                    <div className="text-[11px] font-medium text-amber-800">{checkoutPricing.packNote}</div>
                  )}
                </div>
                <span className="font-mono tabular-nums shrink-0">₹{subtotal}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>GST ({appSettings.taxRatePercent}%)</span>
                <span className="font-mono tabular-nums">₹{tax}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Pan-India Shipping</span>
                <span className="font-mono tabular-nums">₹{shippingFee}</span>
              </div>
              <div className="flex justify-between font-display font-bold text-base text-[#18142C] pt-2 border-t border-[#E9E4F5]">
                <span>Total Payable</span>
                <span className="font-mono tabular-nums">₹{total}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <CardDesignPreviewModal
        open={checkoutPreviewOpen}
        onClose={() => setCheckoutPreviewOpen(false)}
        title="Approved Customized Card Preview"
        subtitle={`${template.name} · ${design.dimensions}`}
        frontDesign={design.frontDesign}
        backDesign={design.backDesign}
        orientation={design.cardOrientation}
        personalInfo={buildEffectiveProfileInfo(profile, userRecord)}
      />
    </PortalLayout>
  );
};

// 8. Customer Orders & Visual Tracking Timeline (Grouped Orders & Tracking Hub)
export const CustomerOrdersPage: React.FC<{ initialTab?: 'orders' | 'tracking' }> = ({ initialTab }) => {
  const { userRecord, appSettings } = useAuth();
  const { orderId } = useParams<{ orderId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<OrderRecord | null>(null);
  const [trackedOrderId, setTrackedOrderId] = useState<string>('');
  const [qrRecord, setQrRecord] = useState<QrCodeRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewDesign, setPreviewDesign] = useState<CardDesignRecord | null>(null);
  const [previewProfileInfo, setPreviewProfileInfo] = useState<Partial<ProfileRecord['personalInformation']>>({});
  const [previewOrderQr, setPreviewOrderQr] = useState<string | undefined>(undefined);

  const tabParam = searchParams.get('tab');
  const activeTab: 'orders' | 'tracking' =
    orderId || tabParam === 'tracking' || initialTab === 'tracking' ? 'tracking' : 'orders';

  const openOrderDesignPreview = async (ord: OrderRecord) => {
    const [des, profs, qr] = await Promise.all([
      getCardDesignById(ord.designId),
      userRecord ? getUserProfiles(userRecord.uid) : Promise.resolve([]),
      ord.qrCodeId && appSettings.allowCustomerQrView ? getQrCodeById(ord.qrCodeId) : Promise.resolve(null),
    ]);
    if (!des) return;
    const matchedProf = profs.find((p) => p.profileId === ord.profileId) || profs[0];
    setPreviewProfileInfo({
      ...(matchedProf?.personalInformation || {}),
      fullName: matchedProf?.personalInformation?.fullName || ord.shippingAddress.fullName,
      mobile: matchedProf?.personalInformation?.mobile || ord.shippingAddress.mobile,
      email: matchedProf?.personalInformation?.email || ord.shippingAddress.email,
    });
    setPreviewOrderQr(qr?.pngDataUrl || undefined);
    setPreviewDesign(des);
  };

  useEffect(() => {
    if (!userRecord) return;
    setLoading(true);
    Promise.all([getCustomerOrders(userRecord.uid), orderId ? getOrderById(orderId) : Promise.resolve(null)])
      .then(async ([list, specific]) => {
        setOrders(list);
        const activeOrd = specific || list[0] || null;
        setSelectedOrder(activeOrd);
        if (activeOrd) setTrackedOrderId(activeOrd.orderId);
        if (activeOrd?.qrCodeId && appSettings.allowCustomerQrView) {
          const qr = await getQrCodeById(activeOrd.qrCodeId);
          setQrRecord(qr);
        } else {
          setQrRecord(null);
        }
      })
      .finally(() => setLoading(false));
  }, [userRecord, orderId, appSettings.allowCustomerQrView]);

  const activeTrackedOrder =
    (orderId ? selectedOrder : orders.find((o) => o.orderId === trackedOrderId) || orders[0]) || null;

  const OrdersTabsBar = (
    <div className="bg-white border border-[#E9E4F5] rounded-2xl p-4 mb-6 flex flex-wrap items-center justify-between gap-3">
      <div className="flex gap-1.5 bg-slate-100 p-1 rounded-xl">
        <button
          type="button"
          onClick={() => {
            if (orderId) navigate('/dashboard/orders');
            else setSearchParams({});
          }}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'orders'
              ? 'bg-[#18142C] text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          My Orders ({orders.length})
        </button>
        <button
          type="button"
          onClick={() => {
            if (!orderId) setSearchParams({ tab: 'tracking' });
          }}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'tracking'
              ? 'bg-[#18142C] text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Truck className="h-3.5 w-3.5" />
          <span>Order Tracking</span>
        </button>
      </div>

      {activeTab === 'tracking' && orders.length > 0 && (
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-600">Select Order:</label>
          <select
            value={activeTrackedOrder?.orderId || ''}
            onChange={(e) => {
              const nextId = e.target.value;
              setTrackedOrderId(nextId);
              if (orderId) navigate(`/dashboard/orders/${nextId}`);
            }}
            className="px-3 py-2 border border-slate-300 rounded-xl text-xs font-mono font-semibold bg-white text-[#18142C]"
          >
            {orders.map((o) => (
              <option key={o.orderId} value={o.orderId}>
                {o.orderNumber} · {o.orderStatus}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );

  return (
    <PortalLayout portal="customer" title="Orders & Tracking">
      {OrdersTabsBar}

      {loading ? (
        <div className="h-64 bg-slate-200 rounded-2xl animate-pulse" />
      ) : activeTab === 'tracking' ? (
        !activeTrackedOrder ? (
          <div className="bg-white border border-[#E9E4F5] rounded-2xl p-10 text-center space-y-3">
            <Truck className="h-9 w-9 text-slate-400 mx-auto" />
            <h2 className="font-display font-bold text-lg text-[#18142C]">No Active Orders to Track</h2>
            <p className="text-sm text-slate-600">
              Once you approve your card design and place an order, its 12-stage fulfilment timeline &amp; courier tracking appear here.
            </p>
            <Link
              to="/dashboard/card-design"
              className="mt-2 inline-block px-5 py-2.5 bg-[#18142C] text-white text-sm font-semibold rounded-xl"
            >
              Design My Card
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="bg-white border border-[#E9E4F5] rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="text-xs font-mono text-slate-500">{activeTrackedOrder.orderNumber}</div>
                <h2 className="font-display text-xl font-bold text-[#18142C] mt-0.5">
                  {activeTrackedOrder.orderStatus}
                </h2>
                <p className="text-xs text-slate-600 mt-1">
                  Expected delivery within 10–15 days within India · Payment: {activeTrackedOrder.paymentStatus}
                </p>
              </div>
              <div className="text-right font-mono space-y-2">
                <div className="text-lg font-bold text-[#18142C] tabular-nums">₹{activeTrackedOrder.total}</div>
                <div className="text-xs text-slate-500">
                  Qty: {activeTrackedOrder.quantity} · {activeTrackedOrder.cardType}
                </div>
                {activeTrackedOrder.orderSource === 'shop' || activeTrackedOrder.designId === 'shop_direct' ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-100 text-xs font-sans font-semibold text-slate-700">
                    Direct Smart Tag Shop Order
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => openOrderDesignPreview(activeTrackedOrder)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E9E4F5] bg-[#FAF9FE] hover:bg-slate-100 text-xs font-sans font-semibold text-[#18142C]"
                  >
                    <Eye className="h-3.5 w-3.5 text-[#7C3AED]" />
                    <span>Preview Ordered Design</span>
                  </button>
                )}
              </div>
            </div>

            {activeTrackedOrder.shopItems && activeTrackedOrder.shopItems.length > 0 && (
              <div className="bg-white border border-[#E9E4F5] rounded-2xl p-5 space-y-3">
                <h3 className="font-display font-bold text-sm text-[#18142C]">Ordered Smart Tags &amp; Products</h3>
                <div className="divide-y divide-[#F0ECF9]">
                  {activeTrackedOrder.shopItems.map((item) => (
                    <div key={item.productId} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <div className="font-semibold text-[#18142C]">{item.name}</div>
                        <div className="text-slate-500">
                          {[item.categoryName, item.cardType].filter(Boolean).join(' · ') || 'Smart Safety Tag'}
                        </div>
                      </div>
                      <div className="text-right font-mono tabular-nums shrink-0">
                        <div>{item.quantity} × ₹{item.priceInr}</div>
                        <div className="font-semibold text-[#18142C]">₹{item.lineTotal ?? item.priceInr * item.quantity}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <FulfilmentTimeline
              currentStatus={activeTrackedOrder.orderStatus}
              courierName={activeTrackedOrder.courierName}
              trackingNumber={activeTrackedOrder.trackingNumber}
              trackingUrl={activeTrackedOrder.trackingUrl}
              dispatchDate={activeTrackedOrder.dispatchDate}
            />

            {activeTrackedOrder.trackingNumber && (
              <div className="bg-white border border-[#E9E4F5] rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <Truck className="h-5 w-5 text-[#7C3AED] mt-0.5" />
                  <div>
                    <div className="font-display font-bold text-sm text-[#18142C]">
                      Dispatched via {activeTrackedOrder.courierName}
                    </div>
                    <div className="text-xs font-mono text-slate-600 mt-0.5">
                      Tracking: {activeTrackedOrder.trackingNumber} · Date: {activeTrackedOrder.dispatchDate}
                    </div>
                  </div>
                </div>
                {activeTrackedOrder.trackingUrl && (
                  <a
                    href={activeTrackedOrder.trackingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 bg-[#18142C] text-white text-xs font-semibold rounded-lg"
                  >
                    Track Shipment
                  </a>
                )}
              </div>
            )}

            <div className="bg-white border border-[#E9E4F5] rounded-2xl p-6">
              <div className="flex items-center gap-2 text-sm font-bold text-[#18142C]">
                <Lock className="h-4 w-4 text-[#7C3AED]" />
                <span>Production QR Code Access</span>
              </div>
              {appSettings.allowCustomerQrView && qrRecord?.pngDataUrl ? (
                <div className="mt-4 flex items-center gap-4">
                  <img src={qrRecord.pngDataUrl} alt="Order QR" className="w-28 h-28 border border-[#E9E4F5] rounded-lg" />
                  <div className="text-xs text-slate-600">
                    <div>Target URL: {qrRecord.targetUrl}</div>
                    <a
                      href={qrRecord.pngDataUrl}
                      download={`${activeTrackedOrder.orderNumber}-qr.png`}
                      className="mt-2 inline-block px-3 py-1.5 bg-[#18142C] text-white rounded text-xs font-semibold"
                    >
                      Download QR PNG
                    </a>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-xs text-slate-500">
                  Your verified QR artwork is securely assigned to our production facility for printing. Raw QR downloads are restricted by administrator policy.
                </p>
              )}
            </div>
          </div>
        )
      ) : orders.length === 0 ? (
        <div className="bg-white border border-[#E9E4F5] rounded-2xl p-10 text-center">
          <h2 className="font-display font-bold text-lg text-[#18142C]">No Card Orders Yet</h2>
          <p className="mt-2 text-sm text-slate-600">Design and approve your smart business card to place your first order.</p>
          <Link to="/dashboard/card-design" className="mt-5 inline-block px-5 py-2.5 bg-[#18142C] text-white text-sm font-semibold rounded-xl">
            Design My Card
          </Link>
        </div>
      ) : (
        <div className="bg-white border border-[#E9E4F5] rounded-2xl overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#FAF9FE] border-b border-[#E9E4F5] text-xs text-slate-500">
              <tr>
                <th className="py-3 px-4">Order</th>
                <th className="py-3 px-4">Card Type</th>
                <th className="py-3 px-4">Qty</th>
                <th className="py-3 px-4">Total</th>
                <th className="py-3 px-4">Payment</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0ECF9]">
              {orders.map((ord) => {
                const isShopOrder = ord.orderSource === 'shop' || ord.designId === 'shop_direct';
                return (
                <tr key={ord.orderId} className="hover:bg-[#FAF9FE]/70">
                  <td className="py-3 px-4 font-mono text-xs font-semibold text-[#18142C]">{ord.orderNumber}</td>
                  <td className="py-3 px-4 text-slate-700">
                    <div>{ord.cardType}</div>
                    {isShopOrder && ord.shopItems && ord.shopItems.length > 0 && (
                      <div className="text-[11px] text-slate-500 truncate max-w-[240px]">
                        {ord.shopItems.map((it) => `${it.quantity}× ${it.name}`).join(', ')}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums">{ord.quantity}</td>
                  <td className="py-3 px-4 font-mono tabular-nums font-semibold">₹{ord.total}</td>
                  <td className="py-3 px-4 text-xs">{ord.paymentStatus}</td>
                  <td className="py-3 px-4 text-xs font-medium text-[#7C3AED]">{ord.orderStatus}</td>
                  <td className="py-3 px-4 text-right space-x-3 whitespace-nowrap">
                    {!isShopOrder && (
                      <button
                        type="button"
                        onClick={() => openOrderDesignPreview(ord)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[#7C3AED] hover:underline"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>Preview Design</span>
                      </button>
                    )}
                    <Link
                      to={`/dashboard/orders/${ord.orderId}`}
                      className="text-xs font-semibold text-[#18142C] hover:underline"
                    >
                      Track →
                    </Link>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {previewDesign && (
        <CardDesignPreviewModal
          open={Boolean(previewDesign)}
          onClose={() => setPreviewDesign(null)}
          title={`Ordered Card Design · ${activeTrackedOrder?.orderNumber || ''}`}
          subtitle={`${previewDesign.dimensions} · ${previewDesign.cardOrientation}`}
          frontDesign={previewDesign.frontDesign}
          backDesign={previewDesign.backDesign}
          orientation={previewDesign.cardOrientation}
          personalInfo={previewProfileInfo}
          actualQrPng={previewOrderQr}
        />
      )}
    </PortalLayout>
  );
};

// Shared Account & Support Grouped Header
const CustomerAccountSupportTabs: React.FC<{ active: 'settings' | 'support' }> = ({ active }) => (
  <div className="bg-white border border-[#E9E4F5] rounded-2xl p-4 mb-6 flex gap-1.5 bg-slate-100/70 w-fit">
    <Link
      to="/dashboard/settings"
      className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
        active === 'settings' ? 'bg-[#18142C] text-white shadow-xs' : 'text-slate-600 hover:bg-white'
      }`}
    >
      Account Security
    </Link>
    <Link
      to="/dashboard/support"
      className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
        active === 'support' ? 'bg-[#18142C] text-white shadow-xs' : 'text-slate-600 hover:bg-white'
      }`}
    >
      Help &amp; Support Tickets
    </Link>
  </div>
);

// 9. Account Settings & Help Support
export const CustomerSettingsPage: React.FC = () => {
  const { userRecord, requestPasswordReset } = useAuth();
  const { notify } = useToast();

  return (
    <PortalLayout portal="customer" title="Account & Support">
      <CustomerAccountSupportTabs active="settings" />
      <div className="bg-white border border-[#E9E4F5] rounded-2xl p-6 max-w-2xl space-y-5">
        <div>
          <h2 className="font-display font-bold text-base text-[#18142C]">Account Information</h2>
          <p className="text-xs text-slate-500 mt-1">Manage your login security and verification status.</p>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm border-t border-[#F0ECF9] pt-4">
          <div>
            <span className="text-xs text-slate-500 block">Email</span>
            <span className="font-medium text-slate-900">{userRecord?.email}</span>
          </div>
          <div>
            <span className="text-xs text-slate-500 block">Role & Status</span>
            <span className="font-medium text-slate-900">{userRecord?.role} · {userRecord?.status}</span>
          </div>
        </div>
        <div className="pt-4 border-t border-[#F0ECF9]">
          <button
            type="button"
            onClick={async () => {
              if (!userRecord?.email) return;
              await requestPasswordReset(userRecord.email);
              notify('Password reset sent', `Sent reset link to ${userRecord.email}.`, 'success');
            }}
            className="px-4 py-2.5 bg-[#18142C] text-white text-xs font-semibold rounded-lg"
          >
            Send Password Reset Email
          </button>
        </div>
      </div>
    </PortalLayout>
  );
};

export const CustomerSupportPage: React.FC = () => {
  const { userRecord } = useAuth();
  const { notify } = useToast();
  const [tickets, setTickets] = useState<SupportTicketRecord[]>([]);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<SupportTicketRecord['category']>('Order');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadTickets = () => {
    if (!userRecord) return;
    getSupportTickets(userRecord.uid).then(setTickets);
  };

  useEffect(() => {
    loadTickets();
  }, [userRecord]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userRecord) return;
    setSubmitting(true);
    try {
      await createSupportTicket({ uid: userRecord.uid, subject, category, message });
      setSubject('');
      setMessage('');
      loadTickets();
      notify('Support ticket submitted', 'Our team will review your request shortly.', 'success');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PortalLayout portal="customer" title="Account & Support">
      <CustomerAccountSupportTabs active="support" />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form onSubmit={handleCreate} className="lg:col-span-5 bg-white border border-[#E9E4F5] rounded-2xl p-6 space-y-4">
          <h2 className="font-display font-bold text-base text-[#18142C]">Open Support or Design Revision Ticket</h2>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as SupportTicketRecord['category'])}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white"
            >
              <option value="Order">Order Status</option>
              <option value="Design Revision">Post-Purchase Design Revision</option>
              <option value="SMART Help">SMART Compatibility &amp; Tap Help</option>
              <option value="Billing">Payment & Billing</option>
              <option value="General">General Inquiry</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Subject</label>
            <input
              type="text"
              required
              minLength={3}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Details</label>
            <textarea
              rows={4}
              required
              minLength={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 bg-[#18142C] text-white rounded-xl text-sm font-semibold"
          >
            <Send className="h-4 w-4" />
            <span>{submitting ? 'Submitting...' : 'Submit Ticket'}</span>
          </button>
        </form>

        <div className="lg:col-span-7 bg-white border border-[#E9E4F5] rounded-2xl p-6 space-y-4">
          <h2 className="font-display font-bold text-base text-[#18142C]">Your Tickets</h2>
          {tickets.length === 0 ? (
            <p className="text-sm text-slate-500">No support tickets yet.</p>
          ) : (
            <div className="space-y-3">
              {tickets.map((t) => (
                <div key={t.ticketId} className="p-4 rounded-xl border border-[#E9E4F5]">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>{t.category}</span>
                    <span className="font-semibold text-[#7C3AED]">{t.status}</span>
                  </div>
                  <div className="font-semibold text-sm text-[#18142C] mt-1">{t.subject}</div>
                  <p className="text-xs text-slate-600 mt-1">{t.message}</p>
                  {t.adminReply && (
                    <div className="mt-2 p-2.5 bg-[#FAF9FE] rounded-lg text-xs text-slate-800 border border-[#E9E4F5]">
                      <strong>Admin Reply:</strong> {t.adminReply}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PortalLayout>
  );
};
