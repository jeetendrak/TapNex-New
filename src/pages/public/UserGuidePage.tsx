import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen,
  Download,
  Search,
  Maximize2,
  X,
  ArrowRight,
  FileText,
  CheckCircle2,
} from 'lucide-react';
import { PublicLayout } from '../../components/PublicLayout';
import {
  ROLE_CAPABILITY_MATRIX,
  ROLE_GUIDES,
  type GuideRoleId,
  type ScreenshotSceneId,
} from '../../data/guideContent';
import { renderGuideScreenshotDataUrl } from '../../lib/guideScreenshots';
import { generateGuidePdfBlob } from '../../lib/guidePdf';
import { downloadBlob } from '../../lib/printPdf';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';

const ALL_ROLE_TABS: Array<{ id: GuideRoleId | 'all'; label: string }> = [
  { id: 'all', label: 'All Roles' },
  { id: 'public', label: 'Public Visitor' },
  { id: 'customer', label: 'Customer' },
  { id: 'printer', label: 'Print Partner' },
  { id: 'admin', label: 'Admin' },
  { id: 'superadmin', label: 'SuperAdmin' },
];

export function getAllowedGuideRolesForUser(role?: string | null): GuideRoleId[] {
  if (role === 'SUPERADMIN') return ['public', 'customer', 'printer', 'admin', 'superadmin'];
  if (role === 'ADMIN') return ['public', 'customer', 'printer', 'admin'];
  if (role === 'PRINTER') return ['public', 'customer', 'printer'];
  return ['public', 'customer'];
}

export const UserGuidePage: React.FC = () => {
  const { userRecord } = useAuth();
  const { notify } = useToast();

  const allowedRoleIds = useMemo(
    () => getAllowedGuideRolesForUser(userRecord?.role),
    [userRecord?.role]
  );
  const isStaffViewer =
    userRecord?.role === 'ADMIN' ||
    userRecord?.role === 'SUPERADMIN' ||
    userRecord?.role === 'PRINTER';

  const visibleRoleTabs = useMemo(
    () =>
      ALL_ROLE_TABS.filter((t) => t.id === 'all' || allowedRoleIds.includes(t.id)).map((t) =>
        t.id === 'all' && !isStaffViewer ? { ...t, label: 'All My Guides' } : t
      ),
    [allowedRoleIds, isStaffViewer]
  );

  const visibleGuides = useMemo(
    () => ROLE_GUIDES.filter((r) => allowedRoleIds.includes(r.roleId)),
    [allowedRoleIds]
  );

  const visibleMatrixRows = useMemo(
    () => ROLE_CAPABILITY_MATRIX.filter((row) => !row.roleId || allowedRoleIds.includes(row.roleId)),
    [allowedRoleIds]
  );

  const [activeRole, setActiveRole] = useState<GuideRoleId | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [screenshots, setScreenshots] = useState<Partial<Record<ScreenshotSceneId, string>>>({});
  const [downloadingTarget, setDownloadingTarget] = useState<GuideRoleId | 'all' | null>(null);
  const [pdfProgress, setPdfProgress] = useState<{ pct: number; label: string } | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; title: string; caption: string } | null>(null);

  useEffect(() => {
    if (activeRole !== 'all' && !allowedRoleIds.includes(activeRole)) {
      setActiveRole('all');
    }
  }, [activeRole, allowedRoleIds]);

  useEffect(() => {
    let cancelled = false;
    const allowedScenes = visibleGuides.flatMap((r) => r.features.map((f) => f.screenshotId));
    Promise.all(
      allowedScenes.map(async (sceneId) => {
        const dataUrl = await renderGuideScreenshotDataUrl(sceneId);
        return [sceneId, dataUrl] as const;
      })
    ).then((entries) => {
      if (cancelled) return;
      const map: Partial<Record<ScreenshotSceneId, string>> = {};
      for (const [id, url] of entries) {
        map[id] = url;
      }
      setScreenshots(map);
    });
    return () => {
      cancelled = true;
    };
  }, [visibleGuides]);

  const filteredRoles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return visibleGuides.filter((role) => activeRole === 'all' || role.roleId === activeRole)
      .map((role) => {
        if (!q) return role;
        const roleMatches =
          role.roleTitle.toLowerCase().includes(q) ||
          role.roleCode.toLowerCase().includes(q) ||
          role.overview.toLowerCase().includes(q);
        if (roleMatches) return role;
        const matchingFeatures = role.features.filter((f) => {
          const hay = [
            f.title,
            f.route,
            f.summary,
            ...f.steps,
            ...f.notes,
            ...f.callouts.map((c) => `${c.title} ${c.detail}`),
          ]
            .join(' ')
            .toLowerCase();
          return hay.includes(q);
        });
        return { ...role, features: matchingFeatures };
      })
      .filter((role) => role.features.length > 0);
  }, [visibleGuides, activeRole, searchQuery]);

  const handleDownloadPdf = async (roleId: GuideRoleId | 'all') => {
    setDownloadingTarget(roleId);
    setPdfProgress({ pct: 5, label: 'Preparing document...' });
    try {
      const { blob, filename, pageCount } = await generateGuidePdfBlob({
        roleId,
        allowedRoleIds,
        onProgress: (pct, label) => setPdfProgress({ pct, label }),
      });
      downloadBlob(blob, filename);
      notify('PDF guide downloaded', `${filename} (${pageCount} pages) saved to your device.`, 'success');
    } catch (err) {
      notify(
        'PDF export failed',
        err instanceof Error ? err.message : 'Could not generate PDF guide.',
        'error'
      );
    } finally {
      setDownloadingTarget(null);
      setTimeout(() => setPdfProgress(null), 900);
    }
  };

  const activeRoleLabel =
    visibleRoleTabs.find((t) => t.id === activeRole)?.label || 'Complete Guide';

  const totalVisibleShots = visibleGuides.reduce((sum, r) => sum + r.features.length, 0);

  const portalHome =
    userRecord?.role === 'SUPERADMIN'
      ? '/superadmin/dashboard'
      : userRecord?.role === 'ADMIN'
        ? '/admin/dashboard'
        : userRecord?.role === 'PRINTER'
          ? '/printer/dashboard'
          : '/dashboard';

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-10">
        {/* Hero Header */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2.5 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
              <BookOpen className="h-4 w-4 text-[#1D4ED8]" />
              <span>Platform Documentation</span>
              <span aria-hidden="true">·</span>
              <span>{visibleGuides.length} {visibleGuides.length === 1 ? 'Section' : 'Guides'}</span>
              <span aria-hidden="true">·</span>
              <span>{totalVisibleShots} Annotated Screenshots</span>
              <span aria-hidden="true">·</span>
              <span>Downloadable A4 PDF</span>
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-bold text-[#0B1D3A] tracking-tight">
              {isStaffViewer ? 'TapNex Complete Role & Feature Guide' : 'TapNex User Guide & Card Handbook'}
            </h1>
            <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
              {isStaffViewer
                ? 'Step-by-step illustrated handbook covering every workflow available to your account—with annotated screen captures ready to download as a formatted PDF manual.'
                : 'Step-by-step illustrated handbook covering creating your Digital Profile, Smart Safety Tags, Card Design Studio, Ordering & Tracking, and instant Public Profile sharing—ready to download as a formatted PDF manual.'}
            </p>
            {userRecord && (
              <div className="pt-1">
                <Link
                  to={portalHome}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1D4ED8] hover:underline"
                >
                  <span>Return to {userRecord.role} Portal</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row lg:flex-col gap-3 shrink-0">
            <button
              type="button"
              disabled={downloadingTarget !== null}
              onClick={() => handleDownloadPdf('all')}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-[#0B1D3A] hover:bg-[#132A52] text-white text-sm font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              <span>
                {downloadingTarget === 'all'
                  ? 'Building PDF Guide...'
                  : isStaffViewer
                    ? 'Download Complete PDF Guide'
                    : 'Download User Guide (PDF)'}
              </span>
            </button>
            {activeRole !== 'all' && (
              <button
                type="button"
                disabled={downloadingTarget !== null}
                onClick={() => handleDownloadPdf(activeRole)}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 border border-slate-300 bg-white hover:bg-slate-50 text-[#0B1D3A] text-sm font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
              >
                <FileText className="h-4 w-4 text-[#1D4ED8]" />
                <span>
                  {downloadingTarget === activeRole
                    ? 'Building Role PDF...'
                    : `Download ${activeRoleLabel} PDF`}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Progress Bar during PDF Composition */}
        {pdfProgress && (
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between text-xs font-medium text-slate-700">
              <span>{pdfProgress.label}</span>
              <span className="font-mono tabular-nums">{pdfProgress.pct}%</span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#1D4ED8] transition-all duration-200"
                style={{ width: `${pdfProgress.pct}%` }}
              />
            </div>
          </div>
        )}

        {/* Role Capability Matrix */}
        <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h2 className="font-display text-lg font-bold text-[#0B1D3A]">
              {isStaffViewer ? 'Role Access & Capability Matrix' : 'Your TapNex Features Overview'}
            </h2>
            <span className="text-xs text-slate-500">
              {isStaffViewer
                ? 'Strict Firebase Auth & Firestore Security Rule Enforcement'
                : 'Quick overview of Public Sharing & Customer Portal tools'}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-3 px-5 font-semibold whitespace-nowrap">Section</th>
                  <th className="py-3 px-5 font-semibold whitespace-nowrap">Access</th>
                  <th className="py-3 px-5 font-semibold whitespace-nowrap">Portal Entry</th>
                  <th className="py-3 px-5 font-semibold">Core Features &amp; Workflows</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleMatrixRows.map((row) => (
                  <tr key={row.role} className="hover:bg-slate-50/70">
                    <td className="py-3.5 px-5 font-semibold text-[#0B1D3A] whitespace-nowrap">
                      {row.role}
                    </td>
                    <td className="py-3.5 px-5 text-slate-600 whitespace-nowrap">
                      {row.accessLevel}
                    </td>
                    <td className="py-3.5 px-5 font-mono text-[#1D4ED8] whitespace-nowrap">
                      {row.portalEntry}
                    </td>
                    <td className="py-3.5 px-5 text-slate-600 leading-relaxed">
                      {row.primaryWorkflows}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Filter Bar: Segmented Role Tabs + Search */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-xl">
            {visibleRoleTabs.map((tab) => {
              const selected = activeRole === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveRole(tab.id)}
                  className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                    selected
                      ? 'bg-white text-[#0B1D3A] shadow-xs'
                      : 'text-slate-600 hover:text-[#0B1D3A]'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="relative w-full lg:w-80">
            <Search className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search feature, route, or step..."
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]"
            />
          </div>
        </div>

        {/* Role Sections */}
        {filteredRoles.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-3">
            <p className="text-sm text-slate-600">
              No guide sections matched &ldquo;{searchQuery}&rdquo;.
            </p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setActiveRole('all');
              }}
              className="px-4 py-2 bg-[#0B1D3A] text-white text-xs font-semibold rounded-lg"
            >
              Reset Filter
            </button>
          </div>
        ) : (
          <div className="space-y-12">
            {filteredRoles.map((role) => (
              <section key={role.roleId} className="space-y-6">
                {/* Role Chapter Header */}
                <div className="bg-[#0B1D3A] text-white rounded-2xl p-6 sm:p-7 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-cyan-300">
                      <span>ROLE: {role.roleCode}</span>
                      <span aria-hidden="true">·</span>
                      <span>ENTRY: {role.portalPath}</span>
                      <span aria-hidden="true">·</span>
                      <span>{role.audience}</span>
                    </div>
                    <h2 className="font-display text-2xl font-bold">{role.roleTitle}</h2>
                    <p className="text-sm text-slate-300 max-w-3xl leading-relaxed">
                      {role.overview}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={downloadingTarget !== null}
                    onClick={() => handleDownloadPdf(role.roleId)}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white text-[#0B1D3A] hover:bg-slate-100 text-xs font-semibold rounded-xl whitespace-nowrap shrink-0 disabled:opacity-60"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>
                      {downloadingTarget === role.roleId ? 'Generating...' : `Export ${role.roleCode} PDF`}
                    </span>
                  </button>
                </div>

                {/* Feature Walkthrough Cards */}
                <div className="space-y-8">
                  {role.features.map((feat) => {
                    const shotSrc = screenshots[feat.screenshotId];
                    return (
                      <article
                        key={feat.id}
                        className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-100 pb-4">
                          <div className="space-y-1">
                            <h3 className="font-display text-xl font-bold text-[#0B1D3A]">
                              {feat.title}
                            </h3>
                            <div className="font-mono text-xs text-[#1D4ED8]">{feat.route}</div>
                          </div>
                          <span className="text-xs font-medium text-slate-500 whitespace-nowrap shrink-0">
                            {feat.steps.length} Steps · {feat.callouts.length} Callouts
                          </span>
                        </div>

                        <p className="text-sm text-slate-600 leading-relaxed">{feat.summary}</p>

                        {/* Annotated Screenshot Container */}
                        <div className="space-y-2">
                          <div className="relative bg-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                            {shotSrc ? (
                              <>
                                <img
                                  src={shotSrc}
                                  alt={feat.screenshotCaption}
                                  referrerPolicy="no-referrer"
                                  className="w-full h-auto block"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    setLightbox({
                                      src: shotSrc,
                                      title: feat.title,
                                      caption: feat.screenshotCaption,
                                    })
                                  }
                                  className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0B1D3A]/90 hover:bg-[#0B1D3A] text-white text-xs font-semibold rounded-lg shadow-sm"
                                >
                                  <Maximize2 className="h-3.5 w-3.5" />
                                  <span>Enlarge Screenshot</span>
                                </button>
                              </>
                            ) : (
                              <div className="aspect-[1280/760] flex flex-col items-center justify-center text-xs text-slate-500 gap-2">
                                <FileText className="h-6 w-6 text-slate-400" />
                                <span>Rendering annotated interface screenshot...</span>
                              </div>
                            )}
                          </div>
                          <p className="text-xs text-slate-500">{feat.screenshotCaption}</p>
                        </div>

                        {/* Two-Column Breakdown: Annotated Callouts + Step-by-Step Guide */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pt-2">
                          <div className="space-y-3">
                            <h4 className="font-display text-sm font-bold text-[#0B1D3A]">
                              Annotated Screen Callouts
                            </h4>
                            <ul className="space-y-3">
                              {feat.callouts.map((c) => (
                                <li key={c.num} className="flex items-start gap-3 text-sm">
                                  <span className="h-6 w-6 rounded-full bg-rose-600 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5 tabular-nums">
                                    {c.num}
                                  </span>
                                  <div>
                                    <div className="font-semibold text-[#0B1D3A]">{c.title}</div>
                                    <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                                      {c.detail}
                                    </p>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>

                          <div className="space-y-4">
                            <div className="space-y-3">
                              <h4 className="font-display text-sm font-bold text-[#0B1D3A]">
                                Step-by-Step Workflow
                              </h4>
                              <ol className="space-y-2.5">
                                {feat.steps.map((step, sIdx) => (
                                  <li key={step} className="flex items-start gap-2.5 text-xs sm:text-sm text-slate-700 leading-relaxed">
                                    <span className="font-mono font-bold text-[#1D4ED8] shrink-0 tabular-nums w-5">
                                      {sIdx + 1}.
                                    </span>
                                    <span>{step}</span>
                                  </li>
                                ))}
                              </ol>
                            </div>

                            {feat.notes.length > 0 && (
                              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
                                <h4 className="text-xs font-bold text-[#0B1D3A]">
                                  Important Rules &amp; Guardrails
                                </h4>
                                <ul className="space-y-1.5">
                                  {feat.notes.map((note) => (
                                    <li key={note} className="flex items-start gap-2 text-xs text-slate-600 leading-relaxed">
                                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                                      <span>{note}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>

      {/* Fullscreen Screenshot Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-6xl w-full overflow-hidden shadow-2xl">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="font-display font-bold text-sm text-[#0B1D3A] truncate">
                  {lightbox.title}
                </div>
                <div className="text-xs text-slate-500 truncate">{lightbox.caption}</div>
              </div>
              <button
                type="button"
                onClick={() => setLightbox(null)}
                className="p-2 rounded-lg text-slate-600 hover:bg-slate-100 shrink-0"
                aria-label="Close screenshot preview"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4 bg-slate-100 max-h-[82vh] overflow-auto">
              <img
                src={lightbox.src}
                alt={lightbox.caption}
                referrerPolicy="no-referrer"
                className="w-full h-auto rounded-lg border border-slate-200"
              />
            </div>
          </div>
        </div>
      )}
    </PublicLayout>
  );
};
