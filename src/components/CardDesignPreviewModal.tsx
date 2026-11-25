import React, { useState } from 'react';
import { CreditCard, Eye, RefreshCw, X } from 'lucide-react';
import { CardCanvasPreview } from './CardCanvasPreview';
import type { CardSideDesign, PersonalInformation } from '../types';

interface CardDesignPreviewModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  frontDesign: CardSideDesign;
  backDesign: CardSideDesign;
  orientation: 'landscape' | 'vertical';
  personalInfo: Partial<PersonalInformation>;
  actualQrPng?: string;
  onEditClick?: () => void;
}

export const CardDesignPreviewModal: React.FC<CardDesignPreviewModalProps> = ({
  open,
  onClose,
  title = 'Customized Card Design Preview',
  subtitle,
  frontDesign,
  backDesign,
  orientation,
  personalInfo,
  actualQrPng,
  onEditClick,
}) => {
  const [viewMode, setViewMode] = useState<'both' | 'flip'>('both');
  const [flippedToBack, setFlippedToBack] = useState(false);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-4xl max-h-[92vh] overflow-y-auto bg-white rounded-3xl border border-slate-200 shadow-2xl">
        {/* Top Modal Bar */}
        <div className="sticky top-0 z-20 bg-[#050814] text-white px-5 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <CreditCard className="h-4 w-4 text-cyan-300 shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-display font-bold truncate">{title}</div>
              <div className="text-[11px] text-slate-300 truncate">
                {subtitle || `${orientation === 'vertical' ? '54.0 × 85.6 mm Vertical' : '85.6 × 54.0 mm Landscape'} · Finished Card Mockup`}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden sm:flex items-center gap-1 p-1 rounded-lg bg-white/10 text-xs">
              <button
                type="button"
                onClick={() => setViewMode('both')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  viewMode === 'both' ? 'bg-white text-[#0B1D3A]' : 'text-slate-200 hover:text-white'
                }`}
              >
                Front &amp; Back
              </button>
              <button
                type="button"
                onClick={() => setViewMode('flip')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  viewMode === 'flip' ? 'bg-white text-[#0B1D3A]' : 'text-slate-200 hover:text-white'
                }`}
              >
                Flip Card
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white"
              aria-label="Close card preview"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Modal Content */}
        <div className="p-5 sm:p-7 space-y-6 bg-slate-50/70">
          {/* Mobile View Switcher */}
          <div className="flex sm:hidden items-center justify-center gap-1 p-1 rounded-xl bg-slate-200/80 text-xs">
            <button
              type="button"
              onClick={() => setViewMode('both')}
              className={`flex-1 py-2 rounded-lg font-semibold ${
                viewMode === 'both' ? 'bg-white text-[#0B1D3A] shadow-xs' : 'text-slate-600'
              }`}
            >
              Front &amp; Back
            </button>
            <button
              type="button"
              onClick={() => setViewMode('flip')}
              className={`flex-1 py-2 rounded-lg font-semibold ${
                viewMode === 'flip' ? 'bg-white text-[#0B1D3A] shadow-xs' : 'text-slate-600'
              }`}
            >
              Flip View
            </button>
          </div>

          {viewMode === 'both' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3 shadow-xs">
                <div className="flex items-center justify-between text-xs font-semibold text-[#0B1D3A]">
                  <span>Front Side</span>
                  <span className="font-mono text-[11px] text-slate-400">Finished Look</span>
                </div>
                <div className="py-2">
                  <CardCanvasPreview
                    side={frontDesign}
                    orientation={orientation}
                    personalInfo={personalInfo}
                    actualQrPng={frontDesign.showQrSlot ? actualQrPng : undefined}
                  />
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3 shadow-xs">
                <div className="flex items-center justify-between text-xs font-semibold text-[#0B1D3A]">
                  <span>Back Side</span>
                  <span className="font-mono text-[11px] text-slate-400">Finished Look</span>
                </div>
                <div className="py-2">
                  <CardCanvasPreview
                    side={backDesign}
                    orientation={orientation}
                    personalInfo={personalInfo}
                    actualQrPng={backDesign.showQrSlot ? actualQrPng : undefined}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-8 flex flex-col items-center space-y-5 shadow-xs">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Showing: {flippedToBack ? 'Back Side' : 'Front Side'}
              </div>
              <div className="w-full max-w-md">
                <CardCanvasPreview
                  side={flippedToBack ? backDesign : frontDesign}
                  orientation={orientation}
                  personalInfo={personalInfo}
                  actualQrPng={(flippedToBack ? backDesign.showQrSlot : frontDesign.showQrSlot) ? actualQrPng : undefined}
                />
              </div>
              <button
                type="button"
                onClick={() => setFlippedToBack((v) => !v)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0B1D3A] hover:bg-[#132A52] text-white text-xs font-semibold min-h-[42px]"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Flip to {flippedToBack ? 'Front Side' : 'Back Side'}</span>
              </button>
            </div>
          )}

          {/* Bottom Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Eye className="h-3.5 w-3.5 text-[#1D4ED8] shrink-0" />
              <span>
                This finished preview hides print bleed guides and editor handles so you can inspect your final card appearance.
              </span>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              {onEditClick && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onEditClick();
                  }}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 min-h-[40px]"
                >
                  Edit in Studio
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl bg-[#0B1D3A] hover:bg-[#132A52] text-white text-xs font-semibold min-h-[40px]"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
