import React, { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { addColorToPalette, getSavedColorPalette, normalizeHexColor } from '../lib/richText';

interface ColorPaletteFieldProps {
  label?: string;
  value: string;
  onChange: (hex: string) => void;
  compact?: boolean;
  allowTransparent?: boolean;
}

export const ColorPaletteField: React.FC<ColorPaletteFieldProps> = ({
  label,
  value,
  onChange,
  compact = false,
  allowTransparent = false,
}) => {
  const [hexDraft, setHexDraft] = useState(value || '#0B1D3A');
  const [palette, setPalette] = useState<string[]>(() => getSavedColorPalette());

  useEffect(() => {
    setHexDraft(value || '#0B1D3A');
  }, [value]);

  const commitColor = (raw: string, saveToPalette = true) => {
    if (allowTransparent && raw.trim().toLowerCase() === 'transparent') {
      setHexDraft('transparent');
      onChange('transparent');
      return;
    }
    const norm = normalizeHexColor(raw);
    if (!norm) return;
    setHexDraft(norm);
    onChange(norm);
    if (saveToPalette) {
      setPalette(addColorToPalette(norm));
    }
  };

  return (
    <div className="space-y-1.5">
      {label && <label className="block text-[11px] font-semibold text-slate-600">{label}</label>}
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={normalizeHexColor(value) || '#0B1D3A'}
          onChange={(e) => {
            const norm = normalizeHexColor(e.target.value) || e.target.value;
            setHexDraft(norm);
            onChange(norm);
          }}
          onBlur={(e) => {
            const norm = normalizeHexColor(e.target.value);
            if (norm) setPalette(addColorToPalette(norm));
          }}
          className={`${compact ? 'w-8 h-8' : 'w-9 h-9'} rounded border border-slate-300 cursor-pointer shrink-0 bg-white p-0.5`}
          title="Pick color"
        />
        <input
          type="text"
          value={hexDraft}
          onChange={(e) => {
            const val = e.target.value;
            setHexDraft(val);
            if (allowTransparent && val.trim().toLowerCase() === 'transparent') {
              onChange('transparent');
              return;
            }
            const norm = normalizeHexColor(val);
            if (norm && val.trim().replace(/^#/, '').length >= 6) {
              onChange(norm);
            }
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text');
            const norm = normalizeHexColor(pasted);
            if (norm) {
              e.preventDefault();
              commitColor(norm, true);
            }
          }}
          onBlur={() => commitColor(hexDraft, true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitColor(hexDraft, true);
            }
          }}
          placeholder="#0B1D3A"
          aria-label={label ? `${label} hex code` : 'Hex color code'}
          className="flex-1 min-w-0 px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-mono bg-white uppercase focus:outline-none focus:border-[#1D4ED8]"
        />
        <button
          type="button"
          onClick={() => commitColor(hexDraft, true)}
          title="Apply & save color to palette"
          className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-semibold shrink-0"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Recently picked / saved color palette swatches */}
      <div className="flex flex-wrap items-center gap-1 pt-0.5">
        {palette.slice(0, compact ? 10 : 14).map((swatch) => {
          const active = value?.toUpperCase() === swatch.toUpperCase();
          return (
            <button
              key={swatch}
              type="button"
              onClick={() => commitColor(swatch, false)}
              title={`Apply saved color ${swatch}`}
              style={{ backgroundColor: swatch }}
              className={`h-4 w-4 rounded-sm border transition-transform hover:scale-110 ${
                active ? 'ring-2 ring-[#1D4ED8] ring-offset-1 border-slate-900' : 'border-slate-300'
              }`}
            />
          );
        })}
        {allowTransparent && (
          <button
            type="button"
            onClick={() => commitColor('transparent', false)}
            title="Transparent fill"
            className={`px-1.5 py-0.5 rounded border text-[9px] font-semibold ${
              value === 'transparent'
                ? 'border-[#1D4ED8] bg-blue-50 text-[#1D4ED8]'
                : 'border-slate-300 bg-white text-slate-600'
            }`}
          >
            None
          </button>
        )}
      </div>
    </div>
  );
};
