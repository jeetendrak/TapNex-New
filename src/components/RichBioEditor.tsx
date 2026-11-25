import React, { useEffect, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Palette,
  Underline,
} from 'lucide-react';
import { addColorToPalette, getSavedColorPalette, normalizeHexColor, sanitizeRichBioHtml } from '../lib/richText';

interface RichBioEditorProps {
  value: string;
  onChange: (sanitizedHtml: string) => void;
  placeholder?: string;
}

export const RichBioEditor: React.FC<RichBioEditorProps> = ({
  value,
  onChange,
  placeholder = 'Write a compelling professional introduction (supports Bold, Italic, Underline, Alignment & Colors)...',
}) => {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [textColor, setTextColor] = useState('#0B1D3A');
  const [hexInput, setHexInput] = useState('#0B1D3A');
  const [palette, setPalette] = useState<string[]>(() => getSavedColorPalette());
  const isInternalUpdateRef = useRef(false);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (isInternalUpdateRef.current) {
      isInternalUpdateRef.current = false;
      return;
    }
    const clean = sanitizeRichBioHtml(value);
    if (el.innerHTML !== clean) {
      el.innerHTML = clean;
    }
  }, [value]);

  const emitChange = () => {
    const el = editorRef.current;
    if (!el) return;
    isInternalUpdateRef.current = true;
    onChange(sanitizeRichBioHtml(el.innerHTML));
  };

  const execFormat = (command: string, arg?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, arg);
    emitChange();
  };

  const applyColor = (rawColor: string, saveToPalette = true) => {
    const norm = normalizeHexColor(rawColor);
    if (!norm) return;
    setTextColor(norm);
    setHexInput(norm);
    if (saveToPalette) {
      setPalette(addColorToPalette(norm));
    }
    editorRef.current?.focus();
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand('foreColor', false, norm);
    emitChange();
  };

  return (
    <div className="border border-slate-300 rounded-xl overflow-hidden bg-white focus-within:border-[#1D4ED8] focus-within:ring-1 focus-within:ring-[#1D4ED8]/20">
      {/* Rich Text Formatting Toolbar */}
      <div className="bg-slate-50 border-b border-slate-200 px-3 py-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execFormat('bold')}
          className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700"
          title="Bold"
        >
          <Bold className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execFormat('italic')}
          className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700"
          title="Italic"
        >
          <Italic className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execFormat('underline')}
          className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700"
          title="Underline"
        >
          <Underline className="h-3.5 w-3.5" />
        </button>

        <span className="h-5 w-px bg-slate-300 mx-1" />

        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execFormat('justifyLeft')}
          className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700"
          title="Align Left"
        >
          <AlignLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execFormat('justifyCenter')}
          className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700"
          title="Align Center"
        >
          <AlignCenter className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execFormat('justifyRight')}
          className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700"
          title="Align Right"
        >
          <AlignRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execFormat('justifyFull')}
          className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700"
          title="Justify"
        >
          <AlignJustify className="h-3.5 w-3.5" />
        </button>

        <span className="h-5 w-px bg-slate-300 mx-1" />

        {/* Text Color Picker + Hex Paste + Saved Swatches */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Palette className="h-3.5 w-3.5 text-slate-500" />
          <input
            type="color"
            value={textColor}
            onChange={(e) => applyColor(e.target.value, true)}
            className="w-7 h-7 rounded border border-slate-300 cursor-pointer bg-white p-0.5"
            title="Pick text color"
          />
          <input
            type="text"
            value={hexInput}
            onChange={(e) => {
              const v = e.target.value;
              setHexInput(v);
              const norm = normalizeHexColor(v);
              if (norm && v.trim().replace(/^#/, '').length >= 6) {
                applyColor(norm, true);
              }
            }}
            onBlur={() => {
              const norm = normalizeHexColor(hexInput);
              if (norm) applyColor(norm, true);
            }}
            placeholder="#0B1D3A"
            className="w-20 px-2 py-1 border border-slate-300 rounded-md text-[11px] font-mono bg-white uppercase"
            title="Paste Hex Color Code"
          />
          <div className="hidden sm:flex items-center gap-1 ml-1">
            {palette.slice(0, 6).map((swatch) => (
              <button
                key={swatch}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyColor(swatch, false)}
                style={{ backgroundColor: swatch }}
                className="w-4 h-4 rounded-sm border border-slate-300 hover:scale-110 transition-transform"
                title={`Apply ${swatch}`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Editable Rich Content Area */}
      <div className="relative">
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={emitChange}
          onBlur={emitChange}
          onPaste={(e) => {
            e.preventDefault();
            const text = e.clipboardData.getData('text/plain');
            document.execCommand('insertText', false, text);
            emitChange();
          }}
          className="min-h-[115px] max-h-[260px] overflow-y-auto px-3.5 py-2.5 text-sm text-slate-800 leading-relaxed focus:outline-none [&_p]:my-1 [&_div]:my-0.5"
        />
        {!value && (
          <div className="pointer-events-none absolute top-2.5 left-3.5 text-sm text-slate-400">
            {placeholder}
          </div>
        )}
      </div>
    </div>
  );
};
