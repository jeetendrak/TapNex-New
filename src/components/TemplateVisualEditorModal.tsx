import React, { useMemo, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Image as ImageIcon,
  Info,
  Italic,
  Move,
  Plus,
  QrCode,
  Sparkles,
  Trash2,
  Underline,
  Upload,
  Wifi,
  X,
  ArrowUpToLine,
  ArrowDownToLine,
  AlignVerticalJustifyCenter,
} from 'lucide-react';
import { CardCanvasPreview, type CardCanvasTarget } from './CardCanvasPreview';
import { ColorPaletteField } from './ColorPaletteField';
import {
  alignTargetsOnSide,
  computeSnapAndGuidelines,
  isSameTarget,
  type AlignAction,
} from '../lib/cardLayout';
import { compressImageFileToDataUrl } from '../lib/qrArtwork';
import type {
  CardSideDesign,
  CardTemplateRecord,
  CardTextElement,
  PersonalInformation,
  ProfileType,
} from '../types';

const TEMPLATE_FONTS = [
  { label: 'Plus Jakarta Sans (Brand)', value: 'Plus Jakarta Sans' },
  { label: 'DM Sans (Brand)', value: 'DM Sans' },
  { label: 'JetBrains Mono (Code)', value: 'JetBrains Mono' },
  { label: 'Arial (System Sans)', value: 'Arial, sans-serif' },
  { label: 'Helvetica (System Sans)', value: 'Helvetica, sans-serif' },
  { label: 'Verdana (System Sans)', value: 'Verdana, sans-serif' },
  { label: 'Georgia (System Serif)', value: 'Georgia, serif' },
  { label: 'Times New Roman (System Serif)', value: 'Times New Roman, serif' },
  { label: 'Courier New (System Mono)', value: 'Courier New, monospace' },
];

const QUICK_TOKENS: {
  label: string;
  token: string;
  fontSizePt: number;
  bold?: boolean;
  types?: ('all' | ProfileType)[];
}[] = [
  { label: 'Full / Pet / Child Name', token: '{{FULL_NAME}}', fontSizePt: 13, bold: true },
  { label: 'Job Title', token: '{{JOB_TITLE}}', fontSizePt: 8.5, types: ['all', 'adult'] },
  { label: 'Company', token: '{{COMPANY}}', fontSizePt: 8.5, bold: true, types: ['all', 'adult'] },
  { label: 'Mobile', token: '{{MOBILE}}', fontSizePt: 8 },
  { label: 'Email', token: '{{EMAIL}}', fontSizePt: 8, types: ['all', 'adult', 'belongings'] },
  { label: 'Website', token: '{{WEBSITE}}', fontSizePt: 7.5, types: ['all', 'adult'] },
  { label: 'Category', token: '{{BUSINESS_CATEGORY}}', fontSizePt: 8, types: ['all', 'adult'] },
  { label: 'City / State', token: '{{CITY_STATE}}', fontSizePt: 7.5 },
  { label: 'Blood Group', token: '{{BLOOD_GROUP}}', fontSizePt: 8.5, bold: true, types: ['all', 'adult', 'kids'] },
  { label: 'Emergency Phone', token: '{{EMERGENCY_PHONE}}', fontSizePt: 8, types: ['all', 'adult', 'kids'] },
  { label: 'Parent Name', token: '{{PARENT_NAME}}', fontSizePt: 8.5, bold: true, types: ['all', 'kids'] },
  { label: 'Parent Mobile', token: '{{PARENT_MOBILE}}', fontSizePt: 8.5, types: ['all', 'kids'] },
  { label: 'School / Class', token: '{{SCHOOL_CLASS}}', fontSizePt: 8, types: ['all', 'kids'] },
  { label: 'Allergies / Medical', token: '{{ALLERGIES}}', fontSizePt: 7.5, types: ['all', 'kids', 'pets'] },
  { label: 'Pet Type', token: '{{PET_TYPE}}', fontSizePt: 8.5, types: ['all', 'pets'] },
  { label: 'Breed', token: '{{BREED}}', fontSizePt: 8, types: ['all', 'pets'] },
  { label: 'Microchip ID', token: '{{MICROCHIP_ID}}', fontSizePt: 7.5, types: ['all', 'pets'] },
  { label: 'Owner Name', token: '{{OWNER_NAME}}', fontSizePt: 8.5, bold: true, types: ['all', 'pets'] },
  { label: 'Owner Mobile', token: '{{OWNER_MOBILE}}', fontSizePt: 8.5, types: ['all', 'pets'] },
  { label: 'Vet Phone', token: '{{VET_PHONE}}', fontSizePt: 8, types: ['all', 'pets'] },
  { label: 'Item Category', token: '{{ITEM_CATEGORY}}', fontSizePt: 8.5, types: ['all', 'belongings'] },
  { label: 'Brand / Model', token: '{{BRAND_MODEL}}', fontSizePt: 8.5, types: ['all', 'belongings'] },
  { label: 'Serial / Tag ID', token: '{{SERIAL_NUMBER}}', fontSizePt: 7.5, types: ['all', 'belongings'] },
  { label: 'Finder Notes', token: '{{FINDER_NOTES}}', fontSizePt: 7.5, types: ['all', 'belongings'] },
];

const SAMPLE_PREVIEW_PERSONA: Partial<PersonalInformation> = {
  fullName: 'Your Name',
  jobTitle: 'Your Designation',
  companyName: 'Your Company Name',
  businessCategory: 'Your Business Category',
  shortBio: 'Your Short Bio',
  mobile: 'Your Number',
  whatsapp: 'Your WhatsApp Number',
  email: 'Your Email ID',
  website: 'Your Website',
  city: 'Your City',
  state: 'State',
};

interface TemplateVisualEditorModalProps {
  initialTemplate: CardTemplateRecord;
  isNew: boolean;
  onClose: () => void;
  onSave: (cleaned: CardTemplateRecord) => Promise<void>;
}

export const TemplateVisualEditorModal: React.FC<TemplateVisualEditorModalProps> = ({
  initialTemplate,
  isNew,
  onClose,
  onSave,
}) => {
  const [draft, setDraft] = useState<CardTemplateRecord>(() => JSON.parse(JSON.stringify(initialTemplate)));
  const [activeSide, setActiveSide] = useState<'front' | 'back'>('front');
  const [previewOrientation, setPreviewOrientation] = useState<'landscape' | 'vertical'>('landscape');
  const [inspectorTab, setInspectorTab] = useState<'background' | 'text' | 'media' | 'details'>('background');
  const [selectedTargets, setSelectedTargets] = useState<CardCanvasTarget[]>([]);
  const [guidelines, setGuidelines] = useState<{ vertical: number[]; horizontal: number[] }>({
    vertical: [],
    horizontal: [],
  });
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const selectedTarget = selectedTargets[0] || null;
  const setSelectedTarget = (t: CardCanvasTarget | null) => setSelectedTargets(t ? [t] : []);

  const currentSide: CardSideDesign = activeSide === 'front' ? draft.frontSpec : draft.backSpec;

  const setCurrentSide = (next: CardSideDesign) => {
    setDraft((prev) =>
      activeSide === 'front' ? { ...prev, frontSpec: next } : { ...prev, backSpec: next }
    );
  };

  const selectedEl = useMemo(
    () =>
      selectedTarget?.kind === 'text'
        ? currentSide.elements.find((el) => el.id === selectedTarget.id) || null
        : null,
    [selectedTarget, currentSide.elements]
  );

  const updateSelectedEl = (patch: Partial<CardTextElement>) => {
    if (!selectedEl) return;
    setCurrentSide({
      ...currentSide,
      elements: currentSide.elements.map((el) => (el.id === selectedEl.id ? { ...el, ...patch } : el)),
    });
  };

  const handleMoveItem = (target: CardCanvasTarget, rawX: number, rawY: number) => {
    const snap = computeSnapAndGuidelines({
      side: currentSide,
      movingTarget: target,
      candidateX: rawX,
      candidateY: rawY,
      orientation: previewOrientation,
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

  const handleUpdateTextValue = (id: string, nextText: string) => {
    setCurrentSide({
      ...currentSide,
      elements: currentSide.elements.map((el) => (el.id === id ? { ...el, text: nextText } : el)),
    });
  };

  const handleAddTextOrToken = (text: string, fontSizePt = 9, bold = false) => {
    const id = `tpl_el_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
    const yCandidates = [14, 24, 34, 44, 54, 64, 74, 82];
    const nextY =
      yCandidates.find((y) => !currentSide.elements.some((el) => Math.abs(el.yPct - y) < 8)) ??
      Math.min(82, 20 + (currentSide.elements.length % 5) * 8);
    const isLightBg = !currentSide.backgroundImageUrl && currentSide.backgroundColor.toLowerCase() === '#ffffff';
    const nextEl: CardTextElement = {
      id,
      text,
      xPct: 8,
      yPct: nextY,
      fontSizePt,
      fontFamily: 'Plus Jakarta Sans',
      fontWeight: bold ? 'bold' : 'normal',
      fontStyle: 'normal',
      textDecoration: 'none',
      color: isLightBg ? '#0B1D3A' : '#FFFFFF',
      align: 'left',
    };
    setCurrentSide({ ...currentSide, elements: [...currentSide.elements, nextEl] });
    setSelectedTarget({ kind: 'text', id });
    setInspectorTab('text');
  };

  const handleUploadSideBackground = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) {
      setErrorMsg('Background file must be under 6 MB.');
      return;
    }
    setErrorMsg('');
    try {
      const compressed = await compressImageFileToDataUrl(file, {
        maxWidth: previewOrientation === 'vertical' ? 709 : 1082,
        maxHeight: previewOrientation === 'vertical' ? 1082 : 709,
        maxChars: 260_000,
      });
      setCurrentSide({ ...currentSide, backgroundImageUrl: compressed });
    } catch {
      setErrorMsg('Failed to read image file. Please try PNG, JPG, or WebP.');
    }
  };

  const handleUploadSideLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErrorMsg('');
    try {
      const compressed = await compressImageFileToDataUrl(file, {
        maxWidth: 480,
        maxHeight: 480,
        maxChars: 130_000,
        preserveAlpha: true,
      });
      setCurrentSide({ ...currentSide, logoDataUrl: compressed });
      setSelectedTarget({ kind: 'logo' });
    } catch {
      setErrorMsg('Failed to process logo image.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (draft.name.trim().length < 2) {
      setErrorMsg('Template name must be at least 2 characters.');
      setInspectorTab('details');
      return;
    }
    setErrorMsg('');
    setSaving(true);
    try {
      const cleaned: CardTemplateRecord = {
        ...draft,
        name: draft.name.trim(),
        priceInr: Math.max(0, Number(draft.priceInr) || 0),
        cardType: (draft.cardType || 'Matte PVC SMART').trim().slice(0, 80),
        category: (draft.category || 'Executive').trim().slice(0, 60),
        profileType: draft.profileType || 'all',
        designTier: draft.designTier || 'designer',
        pricingMode: draft.pricingMode || 'card_tiers',
        packNote: draft.packNote ? draft.packNote.trim().slice(0, 140) : undefined,
        tagKeywords: draft.tagKeywords,
        description: (draft.description || '').trim().slice(0, 400),
      };
      await onSave(cleaned);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save template.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
    >
      <form
        onSubmit={handleSubmit}
        className="bg-white border border-slate-200 rounded-2xl w-full max-w-6xl max-h-[94vh] flex flex-col shadow-2xl overflow-hidden"
      >
        {/* Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-slate-200 bg-slate-50 shrink-0">
          <div>
            <h2 className="font-display font-bold text-base sm:text-lg text-[#0B1D3A]">
              {isNew ? 'Design New Card Template' : `Visual Template Studio — ${draft.name}`}
            </h2>
            <p className="text-[11px] font-mono text-slate-500">
              {draft.templateId} · Drag any text, logo, photo, or QR element with your mouse · Double-click text to edit
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-200 text-slate-500"
            aria-label="Close template studio"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body: Interactive Canvas (Left) + Visual Controls & Metadata (Right) */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Live Mouse-Draggable Canvas */}
          <div className="lg:col-span-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setActiveSide('front');
                    setSelectedTarget(null);
                    setEditingTextId(null);
                  }}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold ${
                    activeSide === 'front' ? 'bg-white text-[#0B1D3A] shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Front Side
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveSide('back');
                    setSelectedTarget(null);
                    setEditingTextId(null);
                  }}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold ${
                    activeSide === 'back' ? 'bg-white text-[#0B1D3A] shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Back Side
                </button>
              </div>

              <div className="inline-flex rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setPreviewOrientation('landscape')}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold ${
                    previewOrientation === 'landscape' ? 'bg-white text-[#0B1D3A] shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Landscape
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewOrientation('vertical')}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold ${
                    previewOrientation === 'vertical' ? 'bg-white text-[#0B1D3A] shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Vertical
                </button>
              </div>
            </div>

            <div className="bg-slate-100 border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-3">
              <CardCanvasPreview
                side={currentSide}
                orientation={previewOrientation}
                personalInfo={SAMPLE_PREVIEW_PERSONA}
                showPrintGuides
                interactive
                selectedTarget={selectedTarget}
                selectedTargets={selectedTargets}
                onSelectTarget={(t, additive) => {
                  if (!t) {
                    setSelectedTarget(null);
                    return;
                  }
                  if (additive) {
                    setSelectedTargets((prev) =>
                      prev.some((p) => isSameTarget(p, t))
                        ? prev.filter((p) => !isSameTarget(p, t))
                        : [...prev, t]
                    );
                  } else {
                    setSelectedTarget(t);
                  }
                  if (t?.kind === 'text') setInspectorTab('text');
                  else if (t?.kind === 'logo' || t?.kind === 'avatar' || t?.kind === 'qr' || t?.kind === 'nfc') setInspectorTab('media');
                }}
                onMoveItem={handleMoveItem}
                onDragEnd={() => setGuidelines({ vertical: [], horizontal: [] })}
                guidelines={guidelines}
                editingTextId={editingTextId}
                onStartEditText={setEditingTextId}
                onUpdateTextValue={handleUpdateTextValue}
              />
              {selectedTargets.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white border border-slate-200">
                  <span className="text-[11px] font-semibold text-[#0B1D3A]">
                    {selectedTargets.length} selected (Shift+Click multi-select)
                  </span>
                  <div className="flex items-center gap-1">
                    {(
                      [
                        { action: 'left', icon: <AlignLeft className="h-3.5 w-3.5" /> },
                        { action: 'center', icon: <AlignCenter className="h-3.5 w-3.5" /> },
                        { action: 'right', icon: <AlignRight className="h-3.5 w-3.5" /> },
                        { action: 'top', icon: <ArrowUpToLine className="h-3.5 w-3.5" /> },
                        { action: 'middle', icon: <AlignVerticalJustifyCenter className="h-3.5 w-3.5" /> },
                        { action: 'bottom', icon: <ArrowDownToLine className="h-3.5 w-3.5" /> },
                      ] as { action: AlignAction; icon: React.ReactNode }[]
                    ).map((btn) => (
                      <button
                        key={btn.action}
                        type="button"
                        onClick={() =>
                          setCurrentSide(alignTargetsOnSide(currentSide, selectedTargets, btn.action, previewOrientation))
                        }
                        className="p-1.5 rounded border border-slate-200 bg-slate-50 hover:bg-[#1D4ED8] hover:text-white text-slate-700"
                        title={`Align ${btn.action}`}
                      >
                        {btn.icon}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-xl bg-blue-50/70 border border-blue-200 p-3 text-xs text-slate-700 flex items-start gap-2.5">
              <Move className="h-4 w-4 text-[#1D4ED8] shrink-0 mt-0.5" />
              <span>
                <strong>Interactive Layout:</strong> Drag text blocks, Logo, Photo, or QR Code directly on the card canvas with your mouse. Double-click any text item to edit placeholders like <code className="font-mono text-[11px] bg-white px-1 rounded">{'{{FULL_NAME}}'}</code> or custom copy.
              </span>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">
                {errorMsg}
              </div>
            )}
          </div>

          {/* Right Column: Tabs for Background Upload, Text Elements, Media/QR, Template Metadata */}
          <div className="lg:col-span-6 space-y-4">
            <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-xl">
              {(
                [
                  { id: 'background', label: 'Background' },
                  { id: 'text', label: 'Text & Layout' },
                  { id: 'media', label: 'Logo / QR' },
                  { id: 'details', label: 'Details & Price' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setInspectorTab(tab.id);
                    if (tab.id === 'text' && (!selectedTarget || selectedTarget.kind !== 'text') && currentSide.elements.length > 0) {
                      setSelectedTarget({ kind: 'text', id: currentSide.elements[0].id });
                    }
                  }}
                  className={`py-2 px-2 rounded-lg text-[11px] font-semibold transition-colors ${
                    inspectorTab === tab.id ? 'bg-white text-[#0B1D3A] shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {inspectorTab === 'background' && (
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#0B1D3A]">
                    <ImageIcon className="h-4 w-4 text-[#1D4ED8]" />
                    <span>{activeSide === 'front' ? 'Front Side' : 'Back Side'} Background &amp; Artwork</span>
                  </div>
                  <span
                    className="inline-flex items-center gap-1 text-[11px] text-slate-500"
                    title="Recommended: 1082 × 709 px (Landscape) or 709 × 1082 px (Vertical) at 300 DPI."
                  >
                    <Info className="h-3.5 w-3.5 text-[#1D4ED8]" />
                    <span>Auto-compressed</span>
                  </span>
                </div>

                <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5 leading-relaxed">
                  <strong>Recommended artwork size:</strong>{' '}
                  {previewOrientation === 'vertical' ? '709 × 1082 px' : '1082 × 709 px'} (300 DPI PNG/JPG). Uploaded designs auto-fit cleanly to the full bleed card dimensions.
                </p>

                <div className="flex flex-wrap items-center gap-2.5">
                  <label className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0B1D3A] hover:bg-[#132A52] text-white text-xs font-semibold cursor-pointer">
                    <Upload className="h-3.5 w-3.5" />
                    <span>{currentSide.backgroundImageUrl ? 'Replace Design / Background' : 'Upload Design / Background'}</span>
                    <input type="file" accept="image/*" className="hidden" onChange={handleUploadSideBackground} />
                  </label>
                  {currentSide.backgroundImageUrl && (
                    <button
                      type="button"
                      onClick={() => setCurrentSide({ ...currentSide, backgroundImageUrl: '' })}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-rose-200 bg-white text-rose-600 text-xs font-semibold hover:bg-rose-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Remove Background Image</span>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200">
                  <ColorPaletteField
                    label="Primary Color"
                    compact
                    value={currentSide.backgroundColor || '#0B1D3A'}
                    onChange={(hex) => setCurrentSide({ ...currentSide, backgroundColor: hex })}
                  />
                  <div className="space-y-1.5">
                    <ColorPaletteField
                      label="Gradient Accent"
                      compact
                      value={currentSide.gradientTo || currentSide.backgroundColor || '#0B1D3A'}
                      onChange={(hex) => setCurrentSide({ ...currentSide, gradientTo: hex })}
                    />
                    {currentSide.gradientTo && (
                      <button
                        type="button"
                        onClick={() => setCurrentSide({ ...currentSide, gradientTo: '' })}
                        className="px-2.5 py-1 text-[11px] border border-slate-300 bg-white rounded-lg text-slate-600"
                      >
                        Use Solid Color
                      </button>
                    )}
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200 space-y-2">
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(currentSide.showBorder)}
                      onChange={(e) =>
                        setCurrentSide({
                          ...currentSide,
                          showBorder: e.target.checked,
                          borderColor: currentSide.borderColor || '#D4AF37',
                          borderWidthPx: currentSide.borderWidthPx || 2,
                        })
                      }
                      className="h-4 w-4 accent-[#1D4ED8]"
                    />
                    <span>Show Card Outer Border ({activeSide === 'front' ? 'Front' : 'Back'})</span>
                  </label>
                  {currentSide.showBorder && (
                    <div className="space-y-2">
                      <ColorPaletteField
                        label="Card Border Color"
                        compact
                        value={currentSide.borderColor || '#D4AF37'}
                        onChange={(hex) => setCurrentSide({ ...currentSide, borderColor: hex })}
                      />
                      <div>
                        <label className="block text-[11px] text-slate-600">
                          Border Thickness: {currentSide.borderWidthPx || 2} px
                        </label>
                        <input
                          type="range"
                          min={1}
                          max={6}
                          value={currentSide.borderWidthPx || 2}
                          onChange={(e) =>
                            setCurrentSide({ ...currentSide, borderWidthPx: Number(e.target.value) })
                          }
                          className="w-full"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {inspectorTab === 'text' && (
              <div className="space-y-3.5">
                <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#0B1D3A] flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-[#1D4ED8]" />
                      <span>Quick Insert Field / Text ({activeSide === 'front' ? 'Front' : 'Back'})</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleAddTextOrToken('Custom Tagline', 9, false)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#1D4ED8] text-white text-[11px] font-semibold"
                    >
                      <Plus className="h-3 w-3" />
                      <span>Custom Text</span>
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_TOKENS.filter(
                      (t) =>
                        !draft.profileType ||
                        draft.profileType === 'all' ||
                        !t.types ||
                        t.types.includes(draft.profileType)
                    ).map((t) => (
                      <button
                        key={t.token}
                        type="button"
                        onClick={() => handleAddTextOrToken(t.token, t.fontSizePt, Boolean(t.bold))}
                        className="px-2 py-1 rounded-md border border-slate-300 bg-white hover:border-[#1D4ED8] text-[11px] font-medium text-slate-700"
                      >
                        + {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Clickable layer list */}
                <div className="p-3 rounded-xl border border-slate-200 space-y-2">
                  <div className="text-[11px] font-semibold text-slate-500">
                    Elements on {activeSide === 'front' ? 'Front' : 'Back'} ({currentSide.elements.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {currentSide.elements.map((el) => {
                      const isSel = selectedEl?.id === el.id;
                      return (
                        <button
                          key={el.id}
                          type="button"
                          onClick={() => setSelectedTarget({ kind: 'text', id: el.id })}
                          className={`max-w-[180px] truncate px-2.5 py-1 rounded-lg text-[11px] font-medium border ${
                            isSel
                              ? 'bg-[#0B1D3A] text-white border-[#0B1D3A]'
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          {el.text}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {selectedEl ? (
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[#0B1D3A]">Selected Text Properties</span>
                      <button
                        type="button"
                        onClick={() => {
                          setCurrentSide({
                            ...currentSide,
                            elements: currentSide.elements.filter((el) => el.id !== selectedEl.id),
                          });
                          setSelectedTarget(null);
                        }}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:underline"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Remove</span>
                      </button>
                    </div>

                    <input
                      type="text"
                      value={selectedEl.text}
                      onChange={(e) => updateSelectedEl({ text: e.target.value })}
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                      placeholder="Text or {{TOKEN}}"
                    />

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-500 mb-1">Font Family</label>
                        <select
                          value={selectedEl.fontFamily}
                          onChange={(e) => updateSelectedEl({ fontFamily: e.target.value })}
                          className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                        >
                          {TEMPLATE_FONTS.map((f) => (
                            <option key={f.value} value={f.value}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 mb-1">Size (pt)</label>
                          <input
                            type="number"
                            min={6}
                            max={28}
                            step={0.5}
                            value={selectedEl.fontSizePt}
                            onChange={(e) => updateSelectedEl({ fontSizePt: Number(e.target.value) })}
                            className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs font-mono bg-white"
                          />
                        </div>
                      </div>
                    </div>
                    <ColorPaletteField
                      label="Text Color (Hex / Palette)"
                      compact
                      value={selectedEl.color}
                      onChange={(hex) => updateSelectedEl({ color: hex })}
                    />

                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => updateSelectedEl({ fontWeight: selectedEl.fontWeight === 'bold' ? 'normal' : 'bold' })}
                        className={`p-1.5 rounded border text-xs ${
                          selectedEl.fontWeight === 'bold' ? 'bg-[#0B1D3A] text-white border-[#0B1D3A]' : 'bg-white border-slate-300'
                        }`}
                        title="Bold"
                      >
                        <Bold className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => updateSelectedEl({ fontStyle: selectedEl.fontStyle === 'italic' ? 'normal' : 'italic' })}
                        className={`p-1.5 rounded border text-xs ${
                          selectedEl.fontStyle === 'italic' ? 'bg-[#0B1D3A] text-white border-[#0B1D3A]' : 'bg-white border-slate-300'
                        }`}
                        title="Italic"
                      >
                        <Italic className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateSelectedEl({ textDecoration: selectedEl.textDecoration === 'underline' ? 'none' : 'underline' })
                        }
                        className={`p-1.5 rounded border text-xs ${
                          selectedEl.textDecoration === 'underline' ? 'bg-[#0B1D3A] text-white border-[#0B1D3A]' : 'bg-white border-slate-300'
                        }`}
                        title="Underline"
                      >
                        <Underline className="h-3.5 w-3.5" />
                      </button>
                      <span className="h-5 w-px bg-slate-300 mx-1" />
                      <button
                        type="button"
                        onClick={() => updateSelectedEl({ uppercase: !selectedEl.uppercase })}
                        className={`px-2 py-1 rounded border text-[11px] font-bold ${
                          selectedEl.uppercase ? 'bg-[#0B1D3A] text-white border-[#0B1D3A]' : 'bg-white border-slate-300'
                        }`}
                        title="Uppercase"
                      >
                        AA
                      </button>
                      <span className="h-5 w-px bg-slate-300 mx-1" />
                      {(['left', 'center', 'right'] as const).map((al) => (
                        <button
                          key={al}
                          type="button"
                          onClick={() => updateSelectedEl({ align: al })}
                          className={`p-1.5 rounded border text-xs ${
                            selectedEl.align === al ? 'bg-[#1D4ED8] text-white border-[#1D4ED8]' : 'bg-white border-slate-300'
                          }`}
                          title={`Align ${al}`}
                        >
                          {al === 'left' ? <AlignLeft className="h-3.5 w-3.5" /> : al === 'center' ? <AlignCenter className="h-3.5 w-3.5" /> : <AlignRight className="h-3.5 w-3.5" />}
                        </button>
                      ))}
                    </div>

                    <div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500 mb-0.5">
                        <span>Arch / Curve: {selectedEl.curveDeg || 0}°</span>
                        {Boolean(selectedEl.curveDeg) && (
                          <button
                            type="button"
                            onClick={() => updateSelectedEl({ curveDeg: 0 })}
                            className="text-[10px] font-semibold text-[#1D4ED8] hover:underline"
                          >
                            Flatten
                          </button>
                        )}
                      </div>
                      <input
                        type="range"
                        min={-130}
                        max={130}
                        step={5}
                        value={selectedEl.curveDeg || 0}
                        onChange={(e) => updateSelectedEl({ curveDeg: Number(e.target.value) })}
                        className="w-full"
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[11px] text-slate-500">X Pos: {selectedEl.xPct}%</label>
                        <input
                          type="range"
                          min={2}
                          max={88}
                          value={selectedEl.xPct}
                          onChange={(e) => updateSelectedEl({ xPct: Number(e.target.value) })}
                          className="w-full"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-slate-500">Y Pos: {selectedEl.yPct}%</label>
                        <input
                          type="range"
                          min={2}
                          max={88}
                          value={selectedEl.yPct}
                          onChange={(e) => updateSelectedEl({ yPct: Number(e.target.value) })}
                          className="w-full"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-slate-500">Width: {selectedEl.maxWidthPct || 82}%</label>
                        <input
                          type="range"
                          min={15}
                          max={95}
                          value={selectedEl.maxWidthPct || 82}
                          onChange={(e) => updateSelectedEl({ maxWidthPct: Number(e.target.value) })}
                          className="w-full"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 px-1">
                    Click any element on the canvas or chip above to style font, alignment, color, or coordinates.
                  </p>
                )}
              </div>
            )}

            {inspectorTab === 'media' && (
              <div className="space-y-4">
                {/* Logo controls */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-3">
                  <div className="text-xs font-bold text-[#0B1D3A]">
                    Brand / Company Logo ({activeSide === 'front' ? 'Front' : 'Back'})
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium cursor-pointer hover:bg-slate-50">
                      <Upload className="h-3.5 w-3.5" />
                      <span>{currentSide.logoDataUrl ? 'Replace Logo Image' : 'Upload Logo Image'}</span>
                      <input type="file" accept="image/*" className="hidden" onChange={handleUploadSideLogo} />
                    </label>
                    {currentSide.logoDataUrl && (
                      <button
                        type="button"
                        onClick={() => setCurrentSide({ ...currentSide, logoDataUrl: '' })}
                        className="px-3 py-1.5 rounded-lg border border-rose-200 bg-white text-rose-600 text-xs font-medium"
                      >
                        Remove Logo
                      </button>
                    )}
                  </div>
                  {currentSide.logoDataUrl && (
                    <div>
                      <label className="block text-[11px] text-slate-600">
                        Logo Width: {currentSide.logoWidthMm || 14} mm (drag logo directly on card to reposition)
                      </label>
                      <input
                        type="range"
                        min={8}
                        max={54}
                        value={currentSide.logoWidthMm || 14}
                        onChange={(e) => setCurrentSide({ ...currentSide, logoWidthMm: Number(e.target.value) })}
                        className="w-full"
                      />
                    </div>
                  )}
                </div>

                {/* QR & NFC & Avatar */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0B1D3A]">
                      <QrCode className="h-3.5 w-3.5 text-[#1D4ED8]" />
                      <span>QR Code Placeholder Slot</span>
                    </span>
                    <label className="inline-flex items-center gap-2 text-xs font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={currentSide.showQrSlot}
                        onChange={(e) => setCurrentSide({ ...currentSide, showQrSlot: e.target.checked })}
                        className="h-4 w-4 accent-[#1D4ED8]"
                      />
                      <span>Show on {activeSide}</span>
                    </label>
                  </div>
                  {currentSide.showQrSlot && (
                    <div>
                      <label className="block text-[11px] text-slate-600">
                        QR Size: {currentSide.qrSizeMm} mm (drag QR box directly on card canvas)
                      </label>
                      <input
                        type="range"
                        min={12}
                        max={28}
                        value={currentSide.qrSizeMm}
                        onChange={(e) => setCurrentSide({ ...currentSide, qrSizeMm: Number(e.target.value) })}
                        className="w-full"
                      />
                    </div>
                  )}

                  <div className="pt-3 border-t border-slate-200 space-y-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={currentSide.showNfcIcon}
                          onChange={(e) => setCurrentSide({ ...currentSide, showNfcIcon: e.target.checked })}
                          className="h-4 w-4 accent-[#1D4ED8]"
                        />
                        <Wifi className="h-3.5 w-3.5 text-[#1D4ED8]" />
                        <span>Show SMART Contactless Icon</span>
                      </label>
                    </div>
                    {currentSide.showNfcIcon && (
                      <div className="space-y-2">
                        <ColorPaletteField
                          label="SMART Icon Color"
                          compact
                          value={currentSide.nfcIconColor || '#38BDF8'}
                          onChange={(hex) => setCurrentSide({ ...currentSide, nfcIconColor: hex })}
                        />
                        <div>
                          <label className="block text-[11px] text-slate-600">
                            SMART Icon Size: {currentSide.nfcSizeMm || 6} mm (drag SMART icon directly on card)
                          </label>
                          <input
                            type="range"
                            min={4}
                            max={14}
                            value={currentSide.nfcSizeMm || 6}
                            onChange={(e) => setCurrentSide({ ...currentSide, nfcSizeMm: Number(e.target.value) })}
                            className="w-full"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {inspectorTab === 'details' && (
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Template Name *</label>
                    <input
                      type="text"
                      required
                      minLength={2}
                      maxLength={100}
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Price (INR) *</label>
                    <input
                      type="number"
                      required
                      min={0}
                      value={draft.priceInr}
                      onChange={(e) => setDraft({ ...draft, priceInr: Number(e.target.value) })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono bg-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Card Type / Finish</label>
                    <input
                      type="text"
                      maxLength={80}
                      value={draft.cardType || ''}
                      onChange={(e) => setDraft({ ...draft, cardType: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Category</label>
                    <input
                      type="text"
                      maxLength={60}
                      value={draft.category || ''}
                      onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Target Profile Type</label>
                    <select
                      value={draft.profileType || 'all'}
                      onChange={(e) =>
                        setDraft({ ...draft, profileType: e.target.value as 'all' | ProfileType })
                      }
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                    >
                      <option value="all">All Profile Types</option>
                      <option value="adult">Adult / Business</option>
                      <option value="kids">Kids Safety</option>
                      <option value="pets">Pets Recovery</option>
                      <option value="belongings">Personal Belongings</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Design Pricing Tier</label>
                    <select
                      value={draft.designTier || 'designer'}
                      onChange={(e) => {
                        const nextTier = e.target.value as 'minimal' | 'designer';
                        setDraft({
                          ...draft,
                          designTier: nextTier,
                          priceInr:
                            (draft.pricingMode || 'card_tiers') === 'fixed_pack'
                              ? draft.priceInr
                              : nextTier === 'minimal'
                                ? 999
                                : 1499,
                        });
                      }}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                    >
                      <option value="minimal">Minimal Design (₹499 QR / ₹999 Smart)</option>
                      <option value="designer">Designer Card (₹599 QR / ₹1,499 Smart)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Pricing Mode</label>
                    <select
                      value={draft.pricingMode || 'card_tiers'}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          pricingMode: e.target.value as 'card_tiers' | 'fixed_pack',
                        })
                      }
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                    >
                      <option value="card_tiers">Card Tiers (QR / Smart Card)</option>
                      <option value="fixed_pack">Fixed Multi-Tag / Sticker Pack</option>
                    </select>
                  </div>
                </div>

                {draft.pricingMode === 'fixed_pack' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Pack Note (shown at checkout)</label>
                    <input
                      type="text"
                      maxLength={140}
                      value={draft.packNote || ''}
                      onChange={(e) => setDraft({ ...draft, packNote: e.target.value })}
                      placeholder="e.g. Pack of 2 Dog Tags · Collar belt not included"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Description</label>
                  <textarea
                    rows={3}
                    maxLength={400}
                    value={draft.description || ''}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    placeholder="Describe card finish, material, and ideal use case..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                  />
                </div>

                <div className="flex flex-wrap gap-5 pt-1">
                  <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.supportsVertical)}
                      onChange={(e) => setDraft({ ...draft, supportsVertical: e.target.checked })}
                      className="h-4 w-4 accent-[#1D4ED8]"
                    />
                    <span>Supports Vertical Orientation</span>
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.active}
                      onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                      className="h-4 w-4 accent-[#1D4ED8]"
                    />
                    <span>Visible to Users in Design Studio</span>
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#0B1D3A] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.isDefault)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          isDefault: e.target.checked,
                          active: e.target.checked ? true : draft.active,
                        })
                      }
                      className="h-4 w-4 accent-amber-600"
                    />
                    <span>Set as Default Template</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50 shrink-0">
          <div className="text-[11px] text-slate-500">
            Changes remain temporary until you click <strong>{isNew ? 'Create Template' : 'Save Template'}</strong>.
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-300 bg-white rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 bg-[#0B1D3A] hover:bg-[#132A52] text-white rounded-lg text-xs font-semibold disabled:opacity-50"
            >
              {saving ? 'Saving...' : isNew ? 'Create Template' : 'Save Template'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
