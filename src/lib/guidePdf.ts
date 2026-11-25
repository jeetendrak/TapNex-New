import { jsPDF } from 'jspdf';
import {
  ROLE_CAPABILITY_MATRIX,
  ROLE_GUIDES,
  type GuideRoleId,
  type RoleGuideSpec,
} from '../data/guideContent';
import { renderGuideScreenshotDataUrl } from './guideScreenshots';

const TAPNEX_LOGO_PATH = '/assets/aistudio/TapNex_Smart_Connections_Logo_79022558.png';

async function loadLogoPngDataUrl(): Promise<{ dataUrl: string; aspect: number } | null> {
  if (typeof document === 'undefined') return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width || 600;
        canvas.height = img.naturalHeight || img.height || 200;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve({
          dataUrl: canvas.toDataURL('image/png'),
          aspect: canvas.width / canvas.height,
        });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = TAPNEX_LOGO_PATH;
  });
}

export interface GenerateGuidePdfOptions {
  roleId?: GuideRoleId | 'all';
  allowedRoleIds?: GuideRoleId[];
  onProgress?: (percent: number, status: string) => void;
}

export async function generateGuidePdfBlob(
  options: GenerateGuidePdfOptions = {}
): Promise<{ blob: Blob; filename: string; pageCount: number }> {
  const targetRole = options.roleId || 'all';
  const allowedSet = options.allowedRoleIds ? new Set<GuideRoleId>(options.allowedRoleIds) : null;
  const permittedGuides = allowedSet
    ? ROLE_GUIDES.filter((r) => allowedSet.has(r.roleId))
    : ROLE_GUIDES;
  const selectedRoles: RoleGuideSpec[] =
    targetRole === 'all' ? permittedGuides : permittedGuides.filter((r) => r.roleId === targetRole);

  if (selectedRoles.length === 0) {
    throw new Error('No guide content found for the selected role.');
  }

  options.onProgress?.(5, 'Loading TapNex brand assets...');
  const logoAsset = await loadLogoPngDataUrl();

  // Pre-render all required screenshots upfront with progress updates
  const allFeatures = selectedRoles.flatMap((r) => r.features);
  const screenshots = new Map<string, string>();
  for (let i = 0; i < allFeatures.length; i++) {
    const feat = allFeatures[i];
    const pct = 10 + Math.round(((i + 1) / Math.max(1, allFeatures.length)) * 55);
    options.onProgress?.(pct, `Rendering screenshot: ${feat.title}...`);
    const png = await renderGuideScreenshotDataUrl(feat.screenshotId);
    if (png) {
      screenshots.set(feat.screenshotId, png);
    }
  }

  options.onProgress?.(70, 'Composing PDF layout & chapters...');

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const pageW = 210;
  const pageH = 297;
  const marginX = 16;
  const contentW = pageW - marginX * 2; // 178mm
  const topY = 20;
  const bottomLimitY = pageH - 18;
  let y = topY;

  const ensureSpace = (neededMm: number) => {
    if (y + neededMm > bottomLimitY) {
      pdf.addPage('a4', 'portrait');
      y = topY;
    }
  };

  // --- COVER PAGE ---
  pdf.setFillColor(11, 29, 58); // #0B1D3A
  pdf.rect(0, 0, pageW, 112, 'F');
  pdf.setFillColor(6, 182, 212); // #06B6D4
  pdf.rect(0, 112, pageW, 2, 'F');

  if (logoAsset) {
    const boxW = 64;
    const boxH = 24;
    pdf.setFillColor(255, 255, 255);
    pdf.roundedRect(marginX, 18, boxW, boxH, 3, 3, 'F');
    const imgH = 18;
    const imgW = Math.min(boxW - 6, imgH * logoAsset.aspect);
    pdf.addImage(
      logoAsset.dataUrl,
      'PNG',
      marginX + (boxW - imgW) / 2,
      18 + (boxH - imgH) / 2,
      imgW,
      imgH,
      undefined,
      'FAST'
    );
  }

  pdf.setTextColor(56, 189, 248);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.text('TAPNEX SMART IDENTITY SYSTEMS  ·  PLATFORM DOCUMENTATION', marginX, 55);

  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(24);
  const includesAdminRoles = selectedRoles.some(
    (r) => r.roleId === 'admin' || r.roleId === 'superadmin'
  );
  const coverTitle =
    targetRole === 'all'
      ? includesAdminRoles
        ? 'Complete User & Operations Guide'
        : 'Customer & Public Profile Guide'
      : `${selectedRoles[0].roleTitle} Guide`;
  pdf.text(coverTitle, marginX, 68);

  pdf.setTextColor(203, 213, 225);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(11.5);
  const coverSub =
    targetRole === 'all'
      ? includesAdminRoles
        ? 'Role-by-role illustrated handbook with annotated screenshots covering Public Profiles, Customer Design Studio, Print Partners, Admin Operations, and SuperAdmin Governance.'
        : 'Illustrated step-by-step handbook with annotated screenshots covering Public Digital Profiles, Smart Safety Tags, Card Design Studio, Ordering, and Tracking.'
      : selectedRoles[0].overview;
  const subLines = pdf.splitTextToSize(coverSub, contentW) as string[];
  pdf.text(subLines, marginX, 79);

  // Cover Metadata & Standards Cards
  y = 128;
  pdf.setFillColor(248, 250, 252);
  pdf.setDrawColor(226, 232, 240);
  pdf.roundedRect(marginX, y, contentW, 42, 3, 3, 'FD');

  pdf.setTextColor(11, 29, 58);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.text('Platform Engineering & Hardware Standards', marginX + 6, y + 10);

  pdf.setTextColor(71, 85, 105);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9.5);
  const stdLines = [
    '• Physical Card Specification: ISO/IEC 7810 ID-1 (85.6 × 54 mm) + 3 mm Print Bleed · 1:1 WYSIWYG 300 DPI PDF',
    '• Dual Identity Technology: NTAG215 SMART Chip URL + Error-Correction-H Fallback QR Code (1024px / SVG)',
    '• Digital Profile Isolation: Field Visibility Controls, Rich Bio, Screen Protection & RFC vCard 3.0 (.vcf)',
    '• Commerce & Fulfilment: 6 Payment Gateways · Payment-Gated Link Unlock · 12-Step Fulfilment (10–15 Days)',
  ];
  stdLines.forEach((line, idx) => {
    pdf.text(line, marginX + 6, y + 18 + idx * 5.8);
  });

  // Cover Contents Snapshot
  y = 182;
  pdf.setTextColor(11, 29, 58);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.text('Included Roles & Modules in This Manual', marginX, y);
  y += 6;

  selectedRoles.forEach((role, idx) => {
    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(226, 232, 240);
    pdf.roundedRect(marginX, y, contentW, 18, 2.5, 2.5, 'FD');

    pdf.setTextColor(29, 78, 216);
    pdf.setFont('courier', 'bold');
    pdf.setFontSize(9);
    pdf.text(`${String(idx + 1).padStart(2, '0')} [${role.roleCode}]`, marginX + 5, y + 7);

    pdf.setTextColor(11, 29, 58);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10.5);
    pdf.text(`${role.roleTitle}  (${role.portalPath})`, marginX + 34, y + 7);

    pdf.setTextColor(100, 116, 139);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    pdf.text(
      `${role.features.length} illustrated section(s) · ${role.audience}`,
      marginX + 34,
      y + 13.5
    );
    y += 21;
  });

  // Cover Footer stamp
  pdf.setTextColor(100, 116, 139);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  const generatedStamp = new Date().toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
  pdf.text(`Generated: ${generatedStamp}  ·  Support: support@tapnex.in`, marginX, pageH - 16);

  // --- PAGE 2: ROLE ACCESS MATRIX ---
  pdf.addPage('a4', 'portrait');
  y = topY;

  pdf.setTextColor(11, 29, 58);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text('Role Access & Capability Matrix', marginX, y);
  y += 6;

  pdf.setTextColor(71, 85, 105);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9.5);
  pdf.text(
    includesAdminRoles
      ? 'Overview of authentication boundaries, entry routes, and responsibilities across TapNex user roles.'
      : 'Overview of entry routes and features for your TapNex customer and public profile workflows.',
    marginX,
    y
  );
  y += 8;

  // Matrix Table Header
  pdf.setFillColor(11, 29, 58);
  pdf.rect(marginX, y, contentW, 9, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.text('Role', marginX + 3, y + 6);
  pdf.text('Authentication', marginX + 38, y + 6);
  pdf.text('Portal Route', marginX + 75, y + 6);
  pdf.text('Primary Workflows', marginX + 109, y + 6);
  y += 9;

  const matrixRows = allowedSet
    ? ROLE_CAPABILITY_MATRIX.filter((r) => !r.roleId || allowedSet.has(r.roleId))
    : ROLE_CAPABILITY_MATRIX;

  matrixRows.forEach((row, idx) => {
    const wfLines = pdf.splitTextToSize(row.primaryWorkflows, 66) as string[];
    const accessLines = pdf.splitTextToSize(row.accessLevel, 34) as string[];
    const routeLines = pdf.splitTextToSize(row.portalEntry, 31) as string[];
    const rowLines = Math.max(wfLines.length, accessLines.length, routeLines.length, 2);
    const rowH = rowLines * 4.3 + 5;

    ensureSpace(rowH);
    pdf.setFillColor(idx % 2 === 0 ? 248 : 255, idx % 2 === 0 ? 250 : 255, idx % 2 === 0 ? 252 : 255);
    pdf.setDrawColor(226, 232, 240);
    pdf.rect(marginX, y, contentW, rowH, 'FD');

    pdf.setTextColor(11, 29, 58);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.text(pdf.splitTextToSize(row.role, 33) as string[], marginX + 3, y + 5);

    pdf.setTextColor(71, 85, 105);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.text(accessLines, marginX + 38, y + 5);

    pdf.setFont('courier', 'bold');
    pdf.setTextColor(29, 78, 216);
    pdf.text(routeLines, marginX + 75, y + 5);

    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(51, 65, 85);
    pdf.text(wfLines, marginX + 109, y + 5);

    y += rowH;
  });

  // --- ROLE CHAPTERS WITH ANNOTATED SCREENSHOTS ---
  for (let rIdx = 0; rIdx < selectedRoles.length; rIdx++) {
    const role = selectedRoles[rIdx];
    pdf.addPage('a4', 'portrait');
    y = topY;

    // Role Banner
    const overviewLines = pdf.splitTextToSize(role.overview, contentW - 12) as string[];
    const bannerH = 22 + overviewLines.length * 4.6;
    pdf.setFillColor(11, 29, 58);
    pdf.roundedRect(marginX, y, contentW, bannerH, 3, 3, 'F');

    pdf.setTextColor(56, 189, 248);
    pdf.setFont('courier', 'bold');
    pdf.setFontSize(9);
    pdf.text(`ROLE ${role.roleCode}  ·  ENTRY: ${role.portalPath}`, marginX + 6, y + 8);

    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    pdf.text(role.roleTitle, marginX + 6, y + 16);

    pdf.setTextColor(226, 232, 240);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.text(overviewLines, marginX + 6, y + 22);
    y += bannerH + 8;

    for (let fIdx = 0; fIdx < role.features.length; fIdx++) {
      const feat = role.features[fIdx];
      if (fIdx > 0) {
        pdf.addPage('a4', 'portrait');
        y = topY;
      }

      // Feature Heading + Route
      const summaryLines = pdf.splitTextToSize(feat.summary, contentW) as string[];
      ensureSpace(24 + summaryLines.length * 4.5);

      pdf.setTextColor(11, 29, 58);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(13.5);
      pdf.text(feat.title, marginX, y);
      y += 5.5;

      pdf.setTextColor(29, 78, 216);
      pdf.setFont('courier', 'bold');
      pdf.setFontSize(8.5);
      pdf.text(`Routes: ${feat.route}`, marginX, y);
      y += 5.5;

      pdf.setTextColor(71, 85, 105);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9.5);
      pdf.text(summaryLines, marginX, y);
      y += summaryLines.length * 4.4 + 4;

      // Embedded Annotated Screenshot (1280x760 aspect => 178mm x 105.7mm)
      const imgData = screenshots.get(feat.screenshotId);
      if (imgData) {
        const imgW = contentW;
        const imgH = +(imgW * (760 / 1280)).toFixed(2);
        ensureSpace(imgH + 10);
        pdf.setDrawColor(203, 213, 225);
        pdf.roundedRect(marginX - 0.5, y - 0.5, imgW + 1, imgH + 1, 2, 2, 'S');
        pdf.addImage(imgData, 'PNG', marginX, y, imgW, imgH, undefined, 'FAST');
        y += imgH + 4.5;

        pdf.setTextColor(100, 116, 139);
        pdf.setFont('helvetica', 'italic');
        pdf.setFontSize(8);
        const capLines = pdf.splitTextToSize(`Figure: ${feat.screenshotCaption}`, contentW) as string[];
        pdf.text(capLines, marginX, y);
        y += capLines.length * 3.8 + 4;
      }

      // Screenshot Callouts Legend
      ensureSpace(14);
      pdf.setTextColor(11, 29, 58);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(10.5);
      pdf.text('Annotated Screen Callouts', marginX, y);
      y += 5;

      feat.callouts.forEach((c) => {
        const detailLines = pdf.splitTextToSize(`${c.title} — ${c.detail}`, contentW - 10) as string[];
        const needed = detailLines.length * 4.2 + 2.5;
        ensureSpace(needed);

        pdf.setFillColor(220, 38, 38);
        pdf.circle(marginX + 3, y - 1.2, 2.5, 'F');
        pdf.setTextColor(255, 255, 255);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7.5);
        pdf.text(String(c.num), marginX + 2.1, y - 0.3);

        pdf.setTextColor(30, 41, 59);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8.8);
        pdf.text(detailLines, marginX + 8.5, y);
        y += needed;
      });
      y += 3;

      // Step-by-Step Walkthrough
      ensureSpace(14);
      pdf.setTextColor(11, 29, 58);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(10.5);
      pdf.text('Step-by-Step Workflow', marginX, y);
      y += 5;

      feat.steps.forEach((step, sIdx) => {
        const stepLines = pdf.splitTextToSize(step, contentW - 8) as string[];
        const needed = stepLines.length * 4.3 + 2.2;
        ensureSpace(needed);

        pdf.setTextColor(29, 78, 216);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9);
        pdf.text(`${sIdx + 1}.`, marginX + 1, y);

        pdf.setTextColor(51, 65, 85);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        pdf.text(stepLines, marginX + 7, y);
        y += needed;
      });
      y += 3;

      // Operational Notes
      if (feat.notes.length > 0) {
        const noteBlockLines = feat.notes.map((n) => pdf.splitTextToSize(`• ${n}`, contentW - 10) as string[]);
        const totalNoteH = noteBlockLines.reduce((acc, ls) => acc + ls.length * 4.1 + 1.5, 11);
        ensureSpace(totalNoteH);

        pdf.setFillColor(248, 250, 252);
        pdf.setDrawColor(226, 232, 240);
        pdf.roundedRect(marginX, y, contentW, totalNoteH, 2.5, 2.5, 'FD');

        pdf.setTextColor(11, 29, 58);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9);
        pdf.text('Important Rules & Security Guardrails', marginX + 4.5, y + 6);

        let ny = y + 11.5;
        pdf.setTextColor(71, 85, 105);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8.5);
        noteBlockLines.forEach((lines) => {
          pdf.text(lines, marginX + 4.5, ny);
          ny += lines.length * 4.1 + 1.5;
        });
        y += totalNoteH + 4;
      }
    }
  }

  // Stamp running header & footer on pages 2..N
  const totalPages = pdf.getNumberOfPages();
  for (let p = 2; p <= totalPages; p++) {
    pdf.setPage(p);
    pdf.setDrawColor(226, 232, 240);
    pdf.line(marginX, 13, pageW - marginX, 13);
    pdf.setTextColor(100, 116, 139);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.text('TapNex Smart Identity Systems  ·  User & Operations Guide', marginX, 10);
    pdf.text(targetRole === 'all' ? 'Complete Edition' : `${selectedRoles[0].roleCode} Edition`, pageW - marginX, 10, {
      align: 'right',
    });

    pdf.line(marginX, pageH - 13, pageW - marginX, pageH - 13);
    pdf.text('https://tapnex.in  ·  support@tapnex.in', marginX, pageH - 8);
    pdf.text(`Page ${p} of ${totalPages}`, pageW - marginX, pageH - 8, { align: 'right' });
  }

  options.onProgress?.(100, 'PDF ready');
  const blob = pdf.output('blob');
  const suffix = targetRole === 'all' ? 'complete-all-roles' : `${targetRole}-role`;
  return {
    blob,
    filename: `tapnex-platform-guide-${suffix}.pdf`,
    pageCount: totalPages,
  };
}
