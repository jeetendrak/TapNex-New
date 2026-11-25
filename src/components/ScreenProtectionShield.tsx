import React, { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';

interface ScreenProtectionShieldProps {
  children: React.ReactNode;
  watermarkLabel?: string;
  active?: boolean;
}

/**
 * Hardens sensitive public profile views against right-click saving, image drag-download,
 * Ctrl/Cmd+S/P/U/Shift+S print & snipping shortcuts, and blurs + watermarks content
 * if a screenshot tool, tab switch, window blur, or Print action is detected.
 */
export const ScreenProtectionShield: React.FC<ScreenProtectionShieldProps> = ({
  children,
  watermarkLabel = 'TAPNEX PROTECTED · SCREENSHOT & SAVE RESTRICTED',
  active = true,
}) => {
  const [captureShielded, setCaptureShielded] = useState(false);

  useEffect(() => {
    if (!active) return;

    const triggerTemporaryShield = () => {
      setCaptureShielded(true);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = (e.key || '').toLowerCase();
      const isCtrlOrMeta = e.ctrlKey || e.metaKey;

      if (e.key === 'PrintScreen' || e.code === 'PrintScreen') {
        e.preventDefault();
        triggerTemporaryShield();
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText('Screenshot capture disabled on TapNex Protected Profile.').catch(() => {});
        }
        return;
      }

      // Snipping tool / screen capture shortcuts (Win+Shift+S, Cmd+Shift+3/4/5, Ctrl+S, Ctrl+P, Ctrl+U)
      if (
        (e.shiftKey && isCtrlOrMeta && ['s', '3', '4', '5'].includes(key)) ||
        (isCtrlOrMeta && ['s', 'p', 'u'].includes(key)) ||
        (isCtrlOrMeta && e.shiftKey && ['i', 'c', 'j'].includes(key))
      ) {
        e.preventDefault();
        triggerTemporaryShield();
      }
    };

    const handleVisibility = () => {
      if (document.hidden) {
        setCaptureShielded(true);
      }
    };

    const handleWindowBlur = () => {
      // Snipping tools & OS screen capture grab window focus
      setCaptureShielded(true);
    };

    const handleWindowFocus = () => {
      setCaptureShielded(false);
    };

    const handleBeforePrint = (e: Event) => {
      e.preventDefault?.();
      setCaptureShielded(true);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'PrintScreen' || e.code === 'PrintScreen') {
        triggerTemporaryShield();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('beforeprint', handleBeforePrint);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('beforeprint', handleBeforePrint);
    };
  }, [active]);

  if (!active) {
    return <>{children}</>;
  }

  return (
    <div
      onContextMenu={(e) => e.preventDefault()}
      onCopy={(e) => e.preventDefault()}
      onCut={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
      className="relative select-none [&_img]:pointer-events-none [&_img]:select-none print:hidden"
      style={{ WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }}
    >
      {/* Subtle always-on non-intrusive security watermark layer embedded inside screenshots */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-30 overflow-hidden opacity-[0.045] flex flex-col justify-between py-10"
      >
        {[0, 1, 2, 3, 4].map((row) => (
          <div
            key={row}
            className="-rotate-18 font-display text-sm sm:text-base font-extrabold tracking-[0.22em] text-slate-900 whitespace-nowrap text-center"
          >
            {watermarkLabel} · {watermarkLabel}
          </div>
        ))}
      </div>

      {/* Main Content (blurred immediately when OS snipping / print / focus loss happens) */}
      <div className={`transition-all duration-150 ${captureShielded ? 'blur-md opacity-25 pointer-events-none' : ''}`}>
        {children}
      </div>

      {/* Active Screenshot / Snipping Protection Curtain */}
      {captureShielded && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center text-white"
          onClick={() => setCaptureShielded(false)}
        >
          <div className="max-w-sm rounded-2xl bg-[#0B1D3A] border border-cyan-400/40 p-6 shadow-2xl space-y-3">
            <ShieldAlert className="h-9 w-9 text-cyan-300 mx-auto" />
            <div className="font-display font-bold text-base">Protected TapNex Profile</div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Downloading, saving, printing, and screen capture are restricted while viewing this profile.
            </p>
            <div className="text-[11px] font-mono uppercase tracking-widest text-cyan-300/90 py-1.5 px-3 rounded-lg bg-white/5 border border-white/10">
              {watermarkLabel}
            </div>
            <button
              type="button"
              onClick={() => setCaptureShielded(false)}
              className="mt-2 px-4 py-2 rounded-xl bg-white text-[#0B1D3A] text-xs font-semibold hover:bg-slate-100"
            >
              Resume Viewing
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
