import type { ScreenshotSceneId } from '../data/guideContent';

const TAPNEX_LOGO_PATH = '/assets/aistudio/TapNex_Smart_Connections_Logo_79022558.png';
const screenshotCache = new Map<ScreenshotSceneId, string>();
let cachedLogoImg: HTMLImageElement | null | undefined;

async function getTapNexLogo(): Promise<HTMLImageElement | null> {
  if (cachedLogoImg !== undefined) return cachedLogoImg;
  if (typeof Image === 'undefined') {
    cachedLogoImg = null;
    return null;
  }
  cachedLogoImg = await new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = TAPNEX_LOGO_PATH;
  });
  return cachedLogoImg;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function fillCard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r = 14,
  fill = '#FFFFFF',
  stroke = '#E2E8F0'
) {
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
  ctx.restore();
}

function drawButton(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  bg = '#0B1D3A',
  fg = '#FFFFFF',
  fontSize = 14
) {
  fillCard(ctx, x, y, w, h, 9, bg, bg);
  ctx.fillStyle = fg;
  ctx.font = `600 ${fontSize}px "Plus Jakarta Sans", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function drawTag(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  bg: string,
  fg: string
) {
  ctx.font = '600 12px "Plus Jakarta Sans", system-ui, sans-serif';
  const tw = ctx.measureText(text).width;
  fillCard(ctx, x, y, tw + 20, 26, 6, bg, bg);
  ctx.fillStyle = fg;
  ctx.fillText(text, x + 10, y + 17);
  return tw + 20;
}

function drawCalloutPin(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  num: number,
  accent = '#DC2626'
) {
  ctx.save();
  ctx.shadowColor = 'rgba(11, 29, 58, 0.28)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.beginPath();
  ctx.arc(x, y, 16, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#FFFFFF';
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 14px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(num), x, y + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function drawMiniQr(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  fillCard(ctx, x, y, size, size, 8, '#FFFFFF', '#CBD5E1');
  const pad = 10;
  const inner = size - pad * 2;
  const cells = 11;
  const cell = inner / cells;
  ctx.fillStyle = '#0B1D3A';
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      const isFinder =
        (r < 3 && c < 3) || (r < 3 && c >= cells - 3) || (r >= cells - 3 && c < 3);
      const isData = ((r * 7 + c * 11 + r * c) % 3 === 0) && !isFinder;
      if (isFinder || isData) {
        ctx.fillRect(x + pad + c * cell, y + pad + r * cell, Math.ceil(cell - 0.8), Math.ceil(cell - 0.8));
      }
    }
  }
}

function drawBrowserChrome(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  url: string
): number {
  ctx.fillStyle = '#F1F5F9';
  ctx.fillRect(0, 0, w, h);

  // Outer window frame
  fillCard(ctx, 12, 12, w - 24, h - 24, 16, '#F8FAFC', '#CBD5E1');

  // Top browser bar
  ctx.save();
  roundRect(ctx, 12, 12, w - 24, 46, 16);
  ctx.clip();
  ctx.fillStyle = '#0F172A';
  ctx.fillRect(12, 12, w - 24, 46);
  ctx.restore();
  ctx.fillStyle = '#0F172A';
  ctx.fillRect(12, 42, w - 24, 16);

  // Window controls
  ['#EF4444', '#F59E0B', '#22C55E'].forEach((c, idx) => {
    ctx.beginPath();
    ctx.arc(38 + idx * 20, 35, 6, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
  });

  // Address pill
  fillCard(ctx, 120, 22, w - 240, 26, 7, '#1E293B', '#334155');
  ctx.fillStyle = '#E2E8F0';
  ctx.font = '500 13px "JetBrains Mono", monospace';
  ctx.fillText(`https://tapnex.in${url}`, 138, 39);

  return 58; // Content start Y
}

function drawPortalShell(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  topY: number,
  portalLabel: string,
  pageTitle: string,
  navItems: string[],
  activeIndex: number,
  logoImg: HTMLImageElement | null
): { contentX: number; contentY: number; contentW: number; contentH: number } {
  const sidebarX = 12;
  const sidebarW = 228;
  const bodyH = h - 12 - topY;

  // Sidebar background
  ctx.save();
  ctx.fillStyle = '#050814';
  ctx.fillRect(sidebarX, topY, sidebarW, bodyH);
  ctx.restore();

  // Logo card inside sidebar
  fillCard(ctx, sidebarX + 14, topY + 14, sidebarW - 28, 52, 10, '#FFFFFF', '#1E293B');
  if (logoImg) {
    const ratio = logoImg.width / logoImg.height || 2.8;
    const drawH = 38;
    const drawW = Math.min(sidebarW - 44, drawH * ratio);
    ctx.drawImage(logoImg, sidebarX + (sidebarW - drawW) / 2, topY + 21, drawW, drawH);
  } else {
    ctx.fillStyle = '#0B1D3A';
    ctx.font = '800 18px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('TapNex', sidebarX + 64, topY + 46);
  }

  ctx.fillStyle = '#38BDF8';
  ctx.font = '600 12px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(portalLabel, sidebarX + 18, topY + 86);

  // Sidebar nav items
  navItems.forEach((label, idx) => {
    const ny = topY + 102 + idx * 42;
    const active = idx === activeIndex;
    if (active) {
      fillCard(ctx, sidebarX + 12, ny, sidebarW - 24, 34, 8, '#1D4ED8', '#1D4ED8');
    }
    ctx.fillStyle = active ? '#FFFFFF' : '#CBD5E1';
    ctx.font = `${active ? '600' : '500'} 13px "Plus Jakarta Sans", sans-serif`;
    ctx.fillText(label, sidebarX + 26, ny + 22);
  });

  // Top Header bar inside main pane
  const mainX = sidebarX + sidebarW;
  const mainW = w - 12 - mainX;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(mainX, topY, mainW, 60);
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(mainX, topY + 60);
  ctx.lineTo(mainX + mainW, topY + 60);
  ctx.stroke();

  ctx.fillStyle = '#64748B';
  ctx.font = '500 12px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(portalLabel, mainX + 24, topY + 22);
  ctx.fillStyle = '#0B1D3A';
  ctx.font = '700 19px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(pageTitle, mainX + 24, topY + 46);

  drawButton(ctx, mainX + mainW - 140, topY + 14, 116, 32, 'Public Site', '#FFFFFF', '#0B1D3A', 12);
  ctx.strokeStyle = '#CBD5E1';
  ctx.strokeRect(mainX + mainW - 140, topY + 14, 116, 32);

  return {
    contentX: mainX + 24,
    contentY: topY + 78,
    contentW: mainW - 48,
    contentH: h - 12 - (topY + 78) - 14,
  };
}

function drawScenePublicLandingAndProfile(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  logoImg: HTMLImageElement | null
) {
  const topY = drawBrowserChrome(ctx, w, h, '/p/priya-deshmukh');

  // Public site top strip
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(12, topY, w - 24, 66);
  if (logoImg) {
    const ratio = logoImg.width / logoImg.height || 2.8;
    const lh = 46;
    ctx.drawImage(logoImg, 36, topY + 10, lh * ratio, lh);
  } else {
    ctx.fillStyle = '#0B1D3A';
    ctx.font = '800 22px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('TapNex', 36, topY + 40);
  }
  ctx.fillStyle = '#475569';
  ctx.font = '500 14px "Plus Jakarta Sans", sans-serif';
  ['How It Works', 'Features', 'Card Designs', 'Pricing', 'Guide (PDF)'].forEach((nav, idx) => {
    ctx.fillText(nav, 360 + idx * 120, topY + 38);
  });
  drawButton(ctx, w - 208, topY + 14, 172, 38, 'Get Your Smart Card', '#0B1D3A', '#FFFFFF', 13);

  // Left: Public Storefront summary
  const leftX = 44;
  const leftY = topY + 96;
  ctx.fillStyle = '#1D4ED8';
  ctx.font = '700 13px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('ISO/IEC 7810 ID-1  ·  NTAG215 SMART + QR HYBRID', leftX, leftY);

  ctx.fillStyle = '#0B1D3A';
  ctx.font = '800 32px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('SMART Business Cards', leftX, leftY + 42);
  ctx.fillText('Built for Instant Exchange.', leftX, leftY + 80);

  ctx.fillStyle = '#475569';
  ctx.font = '400 15px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Tap any modern smartphone or scan the fallback QR code to open', leftX, leftY + 116);
  ctx.fillText('your live public profile at /p/your-name without installing an app.', leftX, leftY + 138);

  // Sample showcase card on left
  fillCard(ctx, leftX, leftY + 172, 520, 290, 18, '#0B1D3A', '#1E293B');
  const grad = ctx.createLinearGradient(leftX, leftY + 172, leftX + 520, leftY + 462);
  grad.addColorStop(0, '#0B1D3A');
  grad.addColorStop(1, '#1D4ED8');
  ctx.save();
  roundRect(ctx, leftX, leftY + 172, 520, 290, 18);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#38BDF8';
  ctx.font = '700 13px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('TAPNEX EXECUTIVE CARD (85.6 x 54 MM)', leftX + 28, leftY + 210);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 26px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Priya Deshmukh', leftX + 28, leftY + 345);
  ctx.fillStyle = '#CBD5E1';
  ctx.font = '500 15px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Principal Architect · Studio Vastu', leftX + 28, leftY + 372);
  ctx.fillText('+91 98230 11240  ·  priya@studiovastu.in', leftX + 28, leftY + 398);
  drawMiniQr(ctx, leftX + 392, leftY + 334, 96);

  // Right: Live Mobile Public Profile (/p/priya-deshmukh)
  const cardX = 630;
  const cardY = topY + 86;
  const cardW = 580;
  const cardH = 584;
  fillCard(ctx, cardX, cardY, cardW, cardH, 22, '#FFFFFF', '#CBD5E1');

  // Dark header banner
  ctx.save();
  roundRect(ctx, cardX, cardY, cardW, 134, 22);
  ctx.clip();
  ctx.fillStyle = '#071226';
  ctx.fillRect(cardX, cardY, cardW, 134);
  ctx.restore();
  ctx.fillStyle = '#071226';
  ctx.fillRect(cardX, cardY + 90, cardW, 44);

  // Prominent logo badge inside header
  fillCard(ctx, cardX + 24, cardY + 20, 190, 62, 12, '#FFFFFF', '#E2E8F0');
  if (logoImg) {
    const ratio = logoImg.width / logoImg.height || 2.8;
    const lh = 46;
    ctx.drawImage(logoImg, cardX + 36, cardY + 28, lh * ratio, lh);
  } else {
    ctx.fillStyle = '#0B1D3A';
    ctx.font = '800 18px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('TapNex', cardX + 52, cardY + 56);
  }
  drawButton(ctx, cardX + cardW - 122, cardY + 30, 96, 38, 'Share', '#1E293B', '#FFFFFF', 13);

  // Avatar circle overlapping header
  ctx.beginPath();
  ctx.arc(cardX + cardW / 2, cardY + 132, 46, 0, Math.PI * 2);
  ctx.fillStyle = '#1D4ED8';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#FFFFFF';
  ctx.stroke();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 26px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('PD', cardX + cardW / 2, cardY + 142);

  // Name & bio
  ctx.fillStyle = '#0B1D3A';
  ctx.font = '700 24px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Priya Deshmukh', cardX + cardW / 2, cardY + 206);
  ctx.fillStyle = '#475569';
  ctx.font = '500 14px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Principal Architect · Studio Vastu', cardX + cardW / 2, cardY + 230);
  ctx.fillStyle = '#64748B';
  ctx.font = '400 13px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Residential & sustainable spatial architecture across Pune and Mumbai.', cardX + cardW / 2, cardY + 260);
  ctx.textAlign = 'left';

  // Save Contact button (WhatsApp is under Connect Online)
  drawButton(ctx, cardX + 36, cardY + 284, 508, 46, 'Save Contact (.vcf)  ·  Screen Protected', '#0B1D3A', '#FFFFFF', 14);

  // Contact rows
  const rows = [
    ['Mobile', '+91 98230 11240'],
    ['Email', 'priya@studiovastu.in'],
    ['Business Address', 'FC Road 12, Pune, Maharashtra'],
    ['Connect Online', 'WhatsApp · LinkedIn · Instagram · Website'],
  ];
  rows.forEach(([k, v], i) => {
    const ry = cardY + 350 + i * 52;
    fillCard(ctx, cardX + 36, ry, cardW - 72, 42, 10, '#F8FAFC', '#E2E8F0');
    ctx.fillStyle = '#64748B';
    ctx.font = '600 12px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(k, cardX + 52, ry + 26);
    ctx.fillStyle = '#0B1D3A';
    ctx.font = '600 13px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(v, cardX + 200, ry + 26);
  });

  // Callout Pins
  drawCalloutPin(ctx, cardX + 210, cardY + 24, 1);
  drawCalloutPin(ctx, cardX + cardW / 2 + 120, cardY + 195, 2);
  drawCalloutPin(ctx, cardX + 160, cardY + 284, 3);
  drawCalloutPin(ctx, cardX + cardW - 44, cardY + 420, 4);
}

function drawSceneCustomerProfileVisibility(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  logoImg: HTMLImageElement | null
) {
  const topY = drawBrowserChrome(ctx, w, h, '/dashboard/profile');
  const box = drawPortalShell(
    ctx,
    w,
    h,
    topY,
    'Customer Portal',
    'My Profile & Public Visibility Hub',
    ['Overview', 'My Profile & Visibility', 'Design My Card', 'Orders & Tracking', 'Account & Support', 'User Guide (PDF)'],
    1,
    logoImg
  );

  // Grouped Hub Tab Bar + Profile Switcher Dropdown
  fillCard(ctx, box.contentX, box.contentY, box.contentW, 52, 12, '#FFFFFF', '#E2E8F0');
  ['Profile Details', 'Social Links', 'Custom Fields', 'Visibility'].forEach((tab, idx) => {
    const tx = box.contentX + 12 + idx * 112;
    drawButton(
      ctx,
      tx,
      box.contentY + 10,
      104,
      32,
      tab,
      idx === 0 ? '#0B1D3A' : '#F1F5F9',
      idx === 0 ? '#FFFFFF' : '#475569',
      11
    );
  });
  fillCard(ctx, box.contentX + 474, box.contentY + 10, 294, 32, 8, '#F8FAFC', '#CBD5E1');
  ctx.fillStyle = '#0B1D3A';
  ctx.font = '600 11px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Profile: Primary Work (/p/priya-deshmukh) ▾', box.contentX + 486, box.contentY + 30);
  drawButton(ctx, box.contentX + box.contentW - 166, box.contentY + 10, 154, 32, '+ Digital Profile', '#1D4ED8', '#FFFFFF', 11);

  const halfW = (box.contentW - 20) / 2;
  const bodyY = box.contentY + 64;
  const bodyH = box.contentH - 64;

  // Left Card: Profile Editor & Cropper
  fillCard(ctx, box.contentX, bodyY, halfW, bodyH, 14, '#FFFFFF', '#E2E8F0');
  ctx.fillStyle = '#0B1D3A';
  ctx.font = '700 16px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Profile Details & Photo Cropper', box.contentX + 20, bodyY + 28);

  // Avatar & Crop controls
  ctx.beginPath();
  ctx.arc(box.contentX + 66, bodyY + 86, 32, 0, Math.PI * 2);
  ctx.fillStyle = '#1D4ED8';
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 19px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('PD', box.contentX + 52, bodyY + 93);
  drawButton(ctx, box.contentX + 116, bodyY + 58, 152, 32, 'Upload & Auto-Fit', '#0B1D3A', '#FFFFFF', 12);
  drawButton(ctx, box.contentX + 278, bodyY + 58, 150, 32, 'Edit / Crop Photo', '#EEF2FF', '#1D4ED8', 12);
  ctx.fillStyle = '#64748B';
  ctx.font = '400 12px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Zoom: 1.25x  ·  Drag focal point to center face inside circle', box.contentX + 116, bodyY + 108);

  // Form fields + smart copy checkboxes
  const fields = [
    ['Mobile Number', '+91 98230 11240', false, ''],
    ['WhatsApp Number', '+91 98230 11240', true, 'Same as Mobile Number'],
    ['Business Address', 'FC Road 12, Pune, MH', false, ''],
    ['Personal Address', 'FC Road 12, Pune, MH', true, 'Same as Business Address'],
  ] as const;

  fields.forEach(([lbl, val, checked, cbLabel], idx) => {
    const fy = bodyY + 136 + idx * 72;
    ctx.fillStyle = '#475569';
    ctx.font = '600 12px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(lbl, box.contentX + 20, fy);
    if (checked && cbLabel) {
      fillCard(ctx, box.contentX + 180, fy - 12, 16, 16, 4, '#1D4ED8', '#1D4ED8');
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '700 11px sans-serif';
      ctx.fillText('✓', box.contentX + 183, fy);
      ctx.fillStyle = '#1D4ED8';
      ctx.font = '600 12px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(cbLabel, box.contentX + 204, fy);
    }
    fillCard(ctx, box.contentX + 20, fy + 8, halfW - 40, 36, 8, '#FFFFFF', '#CBD5E1');
    ctx.fillStyle = '#0F172A';
    ctx.font = '500 13px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(val, box.contentX + 34, fy + 31);
  });

  drawButton(ctx, box.contentX + 20, bodyY + bodyH - 48, 180, 36, 'Save Profile Changes', '#0B1D3A', '#FFFFFF', 13);

  // Right Card Top: Auto-Saved Social Links
  const rightX = box.contentX + halfW + 20;
  fillCard(ctx, rightX, bodyY, halfW, 186, 14, '#FFFFFF', '#E2E8F0');
  ctx.fillStyle = '#0B1D3A';
  ctx.font = '700 15px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Social Links Tab (Auto-Saved)', rightX + 20, bodyY + 28);
  drawTag(ctx, rightX + halfW - 140, bodyY + 12, 'Auto-Save On', '#DCFCE7', '#15803D');

  ['LinkedIn  ·  linkedin.com/in/priya', 'Instagram  ·  instagram.com/studiovastu', 'Calendly  ·  cal.com/priya-consult'].forEach(
    (s, i) => {
      const sy = bodyY + 48 + i * 42;
      fillCard(ctx, rightX + 20, sy, halfW - 40, 34, 8, '#F8FAFC', '#E2E8F0');
      ctx.fillStyle = '#0F172A';
      ctx.font = '500 12px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(s, rightX + 34, sy + 21);
      drawTag(ctx, rightX + halfW - 102, sy + 4, 'Enabled', '#DBEAFE', '#1D4ED8');
    }
  );

  // Right Card Bottom: Public Profile Visibility Toggles
  const visY = bodyY + 202;
  const visH = bodyH - 202;
  fillCard(ctx, rightX, visY, halfW, visH, 14, '#FFFFFF', '#E2E8F0');
  ctx.fillStyle = '#0B1D3A';
  ctx.font = '700 15px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Visibility Tab · Public Profile Controls', rightX + 20, visY + 28);

  const toggles = [
    ['Profile Photo & Full Name', true],
    ['Mobile & WhatsApp Number', true],
    ['Alternate Mobile / Email', false],
    ['Business Address & City/State', true],
    ['Personal Address', false],
    ['Enabled Social Links & Custom Fields', true],
  ] as const;
  toggles.forEach(([label, on], idx) => {
    const ty = visY + 46 + idx * 38;
    fillCard(ctx, rightX + 20, ty, halfW - 40, 31, 8, '#F8FAFC', '#E2E8F0');
    fillCard(ctx, rightX + 32, ty + 7, 17, 17, 4, on ? '#1D4ED8' : '#FFFFFF', on ? '#1D4ED8' : '#94A3B8');
    if (on) {
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '700 11px sans-serif';
      ctx.fillText('✓', rightX + 36, ty + 19);
    }
    ctx.fillStyle = '#0F172A';
    ctx.font = '500 12px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(label, rightX + 60, ty + 19);
  });

  drawCalloutPin(ctx, box.contentX + 240, box.contentY + 12, 1);
  drawCalloutPin(ctx, box.contentX + 754, box.contentY + 12, 2);
  drawCalloutPin(ctx, box.contentX + 350, bodyY + 216, 3);
  drawCalloutPin(ctx, rightX + halfW - 26, visY + 28, 4);
}

function drawSceneCustomerCardStudio(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  logoImg: HTMLImageElement | null
) {
  const topY = drawBrowserChrome(ctx, w, h, '/dashboard/card-design');
  const box = drawPortalShell(
    ctx,
    w,
    h,
    topY,
    'Customer Portal',
    'Design My Card · Blank Canvas & Full Element Studio',
    ['Overview', 'My Profile & Visibility', 'Design My Card', 'Orders & Tracking', 'Account & Support', 'User Guide (PDF)'],
    2,
    logoImg
  );

  // Top Control Strip: Blank Template Upload + Orientation + Actions
  fillCard(ctx, box.contentX, box.contentY, box.contentW, 64, 12, '#FFFFFF', '#E2E8F0');
  drawTag(ctx, box.contentX + 14, box.contentY + 19, 'Blank Custom Card (Start From Scratch)', '#EEF2FF', '#1D4ED8');
  drawButton(ctx, box.contentX + 310, box.contentY + 16, 174, 32, 'Upload Blank Template', '#F1F5F9', '#0B1D3A', 11);
  drawButton(ctx, box.contentX + box.contentW - 418, box.contentY + 14, 128, 36, 'Preview Card', '#EEF2FF', '#1D4ED8', 12);
  drawButton(ctx, box.contentX + box.contentW - 280, box.contentY + 14, 120, 36, 'Save Draft', '#FFFFFF', '#0B1D3A', 12);
  ctx.strokeStyle = '#CBD5E1';
  ctx.strokeRect(box.contentX + box.contentW - 280, box.contentY + 14, 120, 36);
  drawButton(ctx, box.contentX + box.contentW - 150, box.contentY + 14, 138, 36, 'Approve Design', '#059669', '#FFFFFF', 12);

  // Formatting & Width Toolbar
  const barY = box.contentY + 76;
  fillCard(ctx, box.contentX, barY, box.contentW, 54, 12, '#FFFFFF', '#E2E8F0');
  ['B', 'I', 'U', 'Align L/C/R', 'Color Palette', 'Width: 55%', 'SMART: 7.5mm'].forEach((tool, idx) => {
    const offsets = [14, 52, 90, 134, 266, 364, 466];
    const widths = [32, 32, 32, 124, 90, 94, 124];
    const tx = box.contentX + offsets[idx];
    const tw = widths[idx];
    fillCard(ctx, tx, barY + 12, tw, 30, 7, idx === 0 ? '#0B1D3A' : '#F8FAFC', '#CBD5E1');
    ctx.fillStyle = idx === 0 ? '#FFFFFF' : '#0B1D3A';
    ctx.font = '600 11px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(tool, tx + 9, barY + 31);
  });
  drawButton(ctx, box.contentX + box.contentW - 246, barY + 10, 232, 34, '+ Insert Profile Field Dropdown ▾', '#EEF2FF', '#1D4ED8', 11);

  // Left Canvas (Blank / Custom Artwork + Draggable SMART, Logo, Text, QR)
  const canvasAreaY = barY + 68;
  const canvasAreaH = box.contentH - 144;
  const leftW = 580;
  fillCard(ctx, box.contentX, canvasAreaY, leftW, canvasAreaH, 14, '#FFFFFF', '#E2E8F0');

  ctx.fillStyle = '#0B1D3A';
  ctx.font = '700 13px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Front Side · Multi-Select Align, Snap Guides, Borders & Arrow Nudge', box.contentX + 18, canvasAreaY + 26);

  // Card Render with Bleed & Safe Border
  const cx = box.contentX + 36;
  const cy = canvasAreaY + 46;
  const cw = 508;
  const ch = 310;
  const grad = ctx.createLinearGradient(cx, cy, cx + cw, cy + ch);
  grad.addColorStop(0, '#0B1D3A');
  grad.addColorStop(1, '#1E3A8A');
  ctx.save();
  roundRect(ctx, cx, cy, cw, ch, 14);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  // Dashed cyan trim guide
  ctx.save();
  ctx.setLineDash([7, 5]);
  ctx.strokeStyle = '#22D3EE';
  ctx.lineWidth = 1.8;
  ctx.strokeRect(cx + 12, cy + 12, cw - 24, ch - 24);
  ctx.strokeStyle = '#4ADE80';
  ctx.strokeRect(cx + 26, cy + 26, cw - 52, ch - 52);
  ctx.restore();

  // Draggable SMART icon selection box
  ctx.save();
  ctx.strokeStyle = '#38BDF8';
  ctx.lineWidth = 2;
  ctx.strokeRect(cx + 42, cy + 44, 42, 42);
  ctx.restore();
  ctx.fillStyle = '#38BDF8';
  ctx.font = '700 18px sans-serif';
  ctx.fillText(')))', cx + 52, cy + 72);

  // Avatar inside card
  ctx.beginPath();
  ctx.arc(cx + 425, cy + 82, 34, 0, Math.PI * 2);
  ctx.fillStyle = '#38BDF8';
  ctx.fill();
  ctx.fillStyle = '#0B1D3A';
  ctx.font = '700 18px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('PD', cx + 411, cy + 88);

  // Editable text box highlight
  ctx.save();
  ctx.strokeStyle = '#FACC15';
  ctx.lineWidth = 2;
  ctx.strokeRect(cx + 38, cy + 174, 240, 38);
  ctx.restore();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 23px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Priya Deshmukh', cx + 44, cy + 201);
  ctx.fillStyle = '#CBD5E1';
  ctx.font = '500 14px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Principal Architect · Studio Vastu', cx + 44, cy + 230);
  ctx.fillStyle = '#93C5FD';
  ctx.font = '500 13px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('+91 98230 11240  ·  priya@studiovastu.in', cx + 44, cy + 256);

  // Right Inspector: Finished Preview & Element Controls
  const rightX = box.contentX + leftW + 18;
  const rightW = box.contentW - leftW - 18;
  fillCard(ctx, rightX, canvasAreaY, rightW, canvasAreaH, 14, '#FFFFFF', '#E2E8F0');
  ctx.fillStyle = '#0B1D3A';
  ctx.font = '700 14px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Finished Card Preview (Back Side)', rightX + 18, canvasAreaY + 26);

  const bCardX = rightX + 20;
  const bCardY = canvasAreaY + 46;
  const bCardW = rightW - 40;
  const bCardH = 212;
  fillCard(ctx, bCardX, bCardY, bCardW, bCardH, 14, '#0B1D3A', '#1E293B');
  ctx.fillStyle = '#E2E8F0';
  ctx.font = '600 13px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('+91 98230 11240', bCardX + 20, bCardY + 42);
  ctx.fillText('priya@studiovastu.in', bCardX + 20, bCardY + 64);
  ctx.fillStyle = '#94A3B8';
  ctx.font = '500 11px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('tapnex.in/p/priya-deshmukh', bCardX + 20, bCardY + 184);

  // QR Placeholder box on back card
  fillCard(ctx, bCardX + bCardW - 116, bCardY + 86, 94, 94, 10, '#FFFFFF', '#94A3B8');
  ctx.fillStyle = '#475569';
  ctx.font = '700 11px "JetBrains Mono", monospace';
  ctx.fillText('QR SLOT', bCardX + bCardW - 95, bCardY + 136);

  ctx.fillStyle = '#475569';
  ctx.font = '400 12px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Align, Border, Hex Palette & SMART on both sides.', rightX + 20, bCardY + 244);
  ctx.fillText('Upload custom blank templates anytime.', rightX + 20, bCardY + 262);
  drawButton(ctx, rightX + 20, bCardY + 286, bCardW, 38, 'Proceed to Checkout →', '#1D4ED8', '#FFFFFF', 13);

  drawCalloutPin(ctx, box.contentX + 410, box.contentY + 14, 1);
  drawCalloutPin(ctx, box.contentX + 400, barY + 12, 2);
  drawCalloutPin(ctx, cx + 64, cy + 44, 3);
  drawCalloutPin(ctx, box.contentX + box.contentW - 86, box.contentY + 14, 4);
}

function drawSceneCustomerCheckoutFulfilment(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  logoImg: HTMLImageElement | null
) {
  const topY = drawBrowserChrome(ctx, w, h, '/dashboard/orders');
  const box = drawPortalShell(
    ctx,
    w,
    h,
    topY,
    'Customer Portal',
    'Multi-Gateway Checkout & Orders & Tracking Hub',
    ['Overview', 'My Profile & Visibility', 'Design My Card', 'Orders & Tracking', 'Account & Support', 'User Guide (PDF)'],
    3,
    logoImg
  );

  // Top Grouped Orders & Tracking Bar + Multi-Gateway Checkout Strip
  fillCard(ctx, box.contentX, box.contentY, box.contentW, 48, 12, '#FFFFFF', '#E2E8F0');
  drawButton(ctx, box.contentX + 12, box.contentY + 8, 120, 32, 'My Orders (2)', '#F1F5F9', '#475569', 11);
  drawButton(ctx, box.contentX + 140, box.contentY + 8, 136, 32, 'Order Tracking', '#0B1D3A', '#FFFFFF', 11);
  fillCard(ctx, box.contentX + box.contentW - 314, box.contentY + 8, 300, 32, 8, '#F8FAFC', '#CBD5E1');
  ctx.fillStyle = '#0B1D3A';
  ctx.font = '600 11px "JetBrains Mono", monospace';
  ctx.fillText('Order: TNX-2026-84102 · Printing ▾', box.contentX + box.contentW - 302, box.contentY + 28);

  const gwY = box.contentY + 60;
  const gwH = 98;
  fillCard(ctx, box.contentX, gwY, box.contentW, gwH, 14, '#FFFFFF', '#E2E8F0');
  ctx.fillStyle = '#0B1D3A';
  ctx.font = '700 14px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Supported Payment Gateways (Enabled by Admin/SuperAdmin)  ·  Order Total: ₹1,277.82 (incl. 18% GST)', box.contentX + 20, gwY + 28);
  ['Razorpay ✓', 'Cashfree ✓', 'Easebuzz ✓', 'PayU ✓', 'Google Pay ✓', 'Direct UPI ✓'].forEach((gw, idx) => {
    const gx = box.contentX + 20 + idx * 156;
    fillCard(ctx, gx, gwY + 44, 144, 38, 9, idx === 0 ? '#EFF6FF' : '#F8FAFC', idx === 0 ? '#1D4ED8' : '#CBD5E1');
    ctx.fillStyle = idx === 0 ? '#1D4ED8' : '#0B1D3A';
    ctx.font = '600 12px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(gw, gx + 14, gwY + 67);
  });

  // Middle Card: 12-Step Fulfilment Timeline
  const tlY = gwY + gwH + 14;
  const tlH = 266;
  fillCard(ctx, box.contentX, tlY, box.contentW, tlH, 14, '#FFFFFF', '#E2E8F0');
  ctx.fillStyle = '#0B1D3A';
  ctx.font = '700 16px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('End-to-End 12-Step Fulfilment Timeline', box.contentX + 20, tlY + 30);

  const stages = [
    'Design Pending',
    'Design Approved',
    'Awaiting Payment',
    'Payment Successful',
    'Processing',
    'Assigned to Printer',
    'Printing in Progress',
    'Quality Check',
    'Ready for Dispatch',
    'Dispatched',
    'In Transit',
    'Delivered',
  ];
  const cellW = (box.contentW - 60) / 3;
  stages.forEach((stage, idx) => {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    const sx = box.contentX + 20 + col * (cellW + 10);
    const sy = tlY + 48 + row * 50;
    const done = idx <= 6;
    fillCard(
      ctx,
      sx,
      sy,
      cellW,
      40,
      9,
      done ? '#ECFDF5' : '#F8FAFC',
      done ? '#86EFAC' : '#E2E8F0'
    );
    ctx.beginPath();
    ctx.arc(sx + 20, sy + 20, 8, 0, Math.PI * 2);
    ctx.fillStyle = done ? '#16A34A' : '#CBD5E1';
    ctx.fill();
    ctx.fillStyle = done ? '#14532D' : '#64748B';
    ctx.font = '600 12px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(stage, sx + 36, sy + 24);
  });

  // Bottom Split: Courier Tracking & Account & Support Hub
  const botY = tlY + tlH + 14;
  const botH = box.contentH - (botY - box.contentY);
  const halfW = (box.contentW - 18) / 2;

  fillCard(ctx, box.contentX, botY, halfW, botH, 14, '#FFFFFF', '#E2E8F0');
  ctx.fillStyle = '#0B1D3A';
  ctx.font = '700 14px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Courier & Shipping Details', box.contentX + 20, botY + 28);
  ctx.fillStyle = '#475569';
  ctx.font = '500 13px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('BlueDart Express  ·  AWB: BD992014451IN  ·  Est. 10–15 Days', box.contentX + 20, botY + 56);
  ctx.fillText('Delivery: C-202, Sus Gaon, Pune, Maharashtra 411021', box.contentX + 20, botY + 78);

  const rX = box.contentX + halfW + 18;
  fillCard(ctx, rX, botY, halfW, botH, 14, '#FFFFFF', '#E2E8F0');
  ctx.fillStyle = '#0B1D3A';
  ctx.font = '700 14px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Account & Support Hub', rX + 20, botY + 28);
  ctx.fillStyle = '#475569';
  ctx.font = '500 13px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Manage password resets and Order/Design Revision tickets.', rX + 20, botY + 56);
  drawButton(ctx, rX + halfW - 160, botY + 34, 140, 34, 'Open Support', '#0B1D3A', '#FFFFFF', 12);

  drawCalloutPin(ctx, box.contentX + 410, gwY + 44, 1);
  drawCalloutPin(ctx, box.contentX + 205, box.contentY + 12, 2);
  drawCalloutPin(ctx, box.contentX + 340, tlY + 26, 3);
  drawCalloutPin(ctx, rX + 220, botY + 24, 4);
}

function drawScenePrinterProductionDispatch(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  logoImg: HTMLImageElement | null
) {
  const topY = drawBrowserChrome(ctx, w, h, '/printer/orders/ord_84102');
  const box = drawPortalShell(
    ctx,
    w,
    h,
    topY,
    'Printer Portal',
    'Print Partner Job Console & 300 DPI Export',
    ['Printer Dashboard', 'Assigned Orders', 'Facility Profile'],
    1,
    logoImg
  );

  // Left Column: Job Details + Print-Ready Exports
  const leftW = 540;
  fillCard(ctx, box.contentX, box.contentY, leftW, box.contentH, 14, '#FFFFFF', '#E2E8F0');
  ctx.fillStyle = '#0B1D3A';
  ctx.font = '700 17px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Assigned Job #TNX-2026-84102', box.contentX + 20, box.contentY + 32);
  drawTag(ctx, box.contentX + leftW - 164, box.contentY + 14, 'Print File Ready', '#DCFCE7', '#15803D');

  ctx.fillStyle = '#475569';
  ctx.font = '500 13px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Card Type: Matte PVC SMART · Qty: 1 · Dimensions: 85.6 × 54 mm + 3 mm bleed', box.contentX + 20, box.contentY + 64);
  ctx.fillText('SMART Chip Encode Target URL: https://tapnex.in/p/priya-deshmukh', box.contentX + 20, box.contentY + 86);

  // 300 DPI PDF + QR Export Panel
  fillCard(ctx, box.contentX + 20, box.contentY + 106, leftW - 40, 210, 12, '#F8FAFC', '#CBD5E1');
  drawMiniQr(ctx, box.contentX + 36, box.contentY + 124, 124);
  ctx.fillStyle = '#0B1D3A';
  ctx.font = '700 15px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Verified Print Artwork & QR', box.contentX + 180, box.contentY + 146);
  ctx.fillStyle = '#475569';
  ctx.font = '400 12px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('1082 × 709 px (300 DPI) Front & Back PDF with Crop Marks', box.contentX + 180, box.contentY + 170);
  drawButton(ctx, box.contentX + 180, box.contentY + 190, 150, 38, 'Download PDF', '#0B1D3A', '#FFFFFF', 12);
  drawButton(ctx, box.contentX + 338, box.contentY + 190, 96, 38, 'Front PNG', '#F8FAFC', '#0B1D3A', 11);
  drawButton(ctx, box.contentX + 440, box.contentY + 190, 96, 38, 'Back PNG', '#F8FAFC', '#0B1D3A', 11);
  drawButton(ctx, box.contentX + 180, box.contentY + 238, 110, 34, 'QR PNG (1024px)', '#EEF2FF', '#1D4ED8', 11);
  drawButton(ctx, box.contentX + 298, box.contentY + 238, 106, 34, 'QR Vector SVG', '#EEF2FF', '#1D4ED8', 11);

  // Shipping Address Box
  fillCard(ctx, box.contentX + 20, box.contentY + 334, leftW - 40, 150, 12, '#FFFFFF', '#E2E8F0');
  ctx.fillStyle = '#0B1D3A';
  ctx.font = '700 14px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Customer Shipping Label', box.contentX + 36, box.contentY + 362);
  ctx.fillStyle = '#334155';
  ctx.font = '500 13px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Recipient: Priya Deshmukh (+91 98230 11240)', box.contentX + 36, box.contentY + 390);
  ctx.fillText('Address: FC Road 12, Deccan Gymkhana', box.contentX + 36, box.contentY + 414);
  ctx.fillText('Pune, Maharashtra - 411004, India', box.contentX + 36, box.contentY + 438);

  // Right Column: Production Stage Advancement + Courier Dispatch Form
  const rightX = box.contentX + leftW + 20;
  const rightW = box.contentW - leftW - 20;

  fillCard(ctx, rightX, box.contentY, rightW, 200, 14, '#FFFFFF', '#E2E8F0');
  ctx.fillStyle = '#0B1D3A';
  ctx.font = '700 15px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Update 12-Step Production Status', rightX + 20, box.contentY + 32);
  const prodButtons = ['Printing in Progress', 'Quality Check', 'Ready for Dispatch', 'In Transit', 'Delivered'];
  prodButtons.forEach((lbl, idx) => {
    const bx = rightX + 20 + (idx % 2) * 190;
    const by = box.contentY + 52 + Math.floor(idx / 2) * 46;
    drawButton(ctx, bx, by, 178, 36, lbl, idx === 0 ? '#1D4ED8' : '#F1F5F9', idx === 0 ? '#FFFFFF' : '#0B1D3A', 12);
  });

  const dispY = box.contentY + 218;
  fillCard(ctx, rightX, dispY, rightW, box.contentH - 218, 14, '#FFFFFF', '#E2E8F0');
  ctx.fillStyle = '#0B1D3A';
  ctx.font = '700 15px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Courier Dispatch & AWB Tracking', rightX + 20, dispY + 32);

  [
    ['Courier Partner Name *', 'BlueDart Express'],
    ['AWB Tracking Number *', 'BD992014451IN'],
    ['Dispatch Date', '2026-11-19'],
  ].forEach(([lbl, val], i) => {
    const fy = dispY + 52 + i * 62;
    ctx.fillStyle = '#475569';
    ctx.font = '600 12px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(lbl, rightX + 20, fy);
    fillCard(ctx, rightX + 20, fy + 8, rightW - 40, 34, 8, '#F8FAFC', '#CBD5E1');
    ctx.fillStyle = '#0B1D3A';
    ctx.font = '500 13px "JetBrains Mono", monospace';
    ctx.fillText(val, rightX + 32, fy + 30);
  });
  drawButton(ctx, rightX + 20, dispY + box.contentH - 218 - 52, rightW - 40, 38, 'Mark Order Dispatched', '#059669', '#FFFFFF', 13);

  drawCalloutPin(ctx, box.contentX + 330, box.contentY + 24, 1);
  drawCalloutPin(ctx, box.contentX + 390, box.contentY + 190, 2);
  drawCalloutPin(ctx, rightX + 300, box.contentY + 26, 3);
  drawCalloutPin(ctx, rightX + 300, dispY + 26, 4);
}

function drawSceneAdminApprovedPrintTemplates(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  logoImg: HTMLImageElement | null
) {
  const topY = drawBrowserChrome(ctx, w, h, '/admin/approved-designs');
  const box = drawPortalShell(
    ctx,
    w,
    h,
    topY,
    'Admin Portal',
    'Cards & Approved Designs Hub',
    [
      'Dashboard',
      'Users, Profiles & Printers',
      'Cards & Approved Designs',
      'Orders, Payments & Shipping',
      'Gateways, QR & Reports',
      'User Guide (PDF)',
    ],
    2,
    logoImg
  );

  // Grouped Hub Tab Bar
  fillCard(ctx, box.contentX, box.contentY, box.contentW, 44, 10, '#FFFFFF', '#E2E8F0');
  drawButton(ctx, box.contentX + 10, box.contentY + 7, 134, 30, 'Card Templates', '#F1F5F9', '#475569', 11);
  drawButton(ctx, box.contentX + 152, box.contentY + 7, 152, 30, 'Approved Designs', '#0B1D3A', '#FFFFFF', 11);

  const listY = box.contentY + 54;
  const topH = 232;
  fillCard(ctx, box.contentX, listY, box.contentW, topH, 14, '#FFFFFF', '#E2E8F0');
  ctx.fillStyle = '#0B1D3A';
  ctx.font = '700 15px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Customer Approved Designs Ready for Production', box.contentX + 20, listY + 28);

  const designs = [
    ['Priya Deshmukh', '/p/priya-deshmukh', 'Executive Navy · 85.6×54mm', 'Ready to Send'],
    ['Aarav Mehta', '/p/aarav-mehta', 'Blank Custom Artwork · 85.6×54mm', 'Order Linked'],
  ];
  designs.forEach(([name, slug, spec, state], i) => {
    const ry = listY + 46 + i * 86;
    fillCard(ctx, box.contentX + 20, ry, box.contentW - 40, 74, 12, '#F8FAFC', '#E2E8F0');
    fillCard(ctx, box.contentX + 34, ry + 9, 92, 56, 8, i === 0 ? '#0B1D3A' : '#111827', '#1E293B');
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 10px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(name.split(' ')[0], box.contentX + 42, ry + 42);

    ctx.fillStyle = '#0B1D3A';
    ctx.font = '700 14px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(`${name}  (${slug})`, box.contentX + 144, ry + 28);
    ctx.fillStyle = '#64748B';
    ctx.font = '500 12px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(`${spec}  ·  Status: ${state}`, box.contentX + 144, ry + 50);

    drawButton(ctx, box.contentX + box.contentW - 336, ry + 18, 110, 36, 'Preview', '#FFFFFF', '#0B1D3A', 12);
    drawButton(ctx, box.contentX + box.contentW - 216, ry + 18, 128, 36, 'Send to Print', '#1D4ED8', '#FFFFFF', 12);
    drawButton(ctx, box.contentX + box.contentW - 78, ry + 18, 42, 36, '🗑', '#FEE2E2', '#DC2626', 14);
  });

  // Bottom Row: Template Editor + Printer Auto Auth ID
  const botY = listY + topH + 14;
  const botH = box.contentH - (botY - box.contentY);
  const leftW = 580;

  fillCard(ctx, box.contentX, botY, leftW, botH, 14, '#FFFFFF', '#E2E8F0');
  ctx.fillStyle = '#0B1D3A';
  ctx.font = '700 15px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Card Templates Studio (Upload Blank/Bg & Drag Elements)', box.contentX + 20, botY + 28);
  fillCard(ctx, box.contentX + 20, botY + 46, 250, 34, 8, '#F8FAFC', '#CBD5E1');
  ctx.fillStyle = '#0B1D3A';
  ctx.font = '500 12px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Name: Customized Google Review', box.contentX + 30, botY + 67);
  fillCard(ctx, box.contentX + 280, botY + 46, 130, 34, 8, '#F8FAFC', '#CBD5E1');
  ctx.fillText('Price: ₹499', box.contentX + 292, botY + 67);
  drawButton(ctx, box.contentX + 422, botY + 46, 138, 34, 'Upload Bg Image', '#EEF2FF', '#1D4ED8', 12);
  ctx.fillStyle = '#64748B';
  ctx.font = '400 12px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Drag logo, text, SMART wave & QR slot directly on canvas before saving.', box.contentX + 20, botY + 104);
  drawButton(ctx, box.contentX + 20, botY + 124, 170, 34, 'Save Template Changes', '#0B1D3A', '#FFFFFF', 12);

  const rightX = box.contentX + leftW + 18;
  const rightW = box.contentW - leftW - 18;
  fillCard(ctx, rightX, botY, rightW, botH, 14, '#FFFFFF', '#E2E8F0');
  ctx.fillStyle = '#0B1D3A';
  ctx.font = '700 15px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Printers Tab (Auto Print Auth ID)', rightX + 20, botY + 28);
  fillCard(ctx, rightX + 20, botY + 46, rightW - 40, 34, 8, '#F8FAFC', '#CBD5E1');
  ctx.fillStyle = '#1D4ED8';
  ctx.font = '600 12px "JetBrains Mono", monospace';
  ctx.fillText('Auto ID: prt_m4x91a_8820k', rightX + 32, botY + 67);
  ctx.fillStyle = '#475569';
  ctx.font = '500 12px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Press: Apex SMART Prints · Mumbai · Active', rightX + 20, botY + 104);
  drawButton(ctx, rightX + 20, botY + 124, 166, 34, 'Generate & Add Printer', '#0B1D3A', '#FFFFFF', 12);

  drawCalloutPin(ctx, box.contentX + box.contentW - 150, listY + 60, 1);
  drawCalloutPin(ctx, box.contentX + box.contentW - 56, listY + 60, 2);
  drawCalloutPin(ctx, box.contentX + 490, botY + 34, 3);
  drawCalloutPin(ctx, rightX + rightW - 36, botY + 34, 4);
}

function drawSceneAdminOrdersAuditLogs(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  logoImg: HTMLImageElement | null
) {
  const topY = drawBrowserChrome(ctx, w, h, '/admin/profiles');
  const box = drawPortalShell(
    ctx,
    w,
    h,
    topY,
    'Admin Portal',
    'Profile Inspector, Manual Link Approval & Gateway Control',
    [
      'Dashboard',
      'Users, Profiles & Printers',
      'Cards & Approved Designs',
      'Orders, Payments & Shipping',
      'Gateways, QR & Reports',
      'User Guide (PDF)',
    ],
    1,
    logoImg
  );

  // Top Dual Cards: Full Profile Inspector & Approve Without Payment + Payment Gateways Checkboxes
  const halfW = (box.contentW - 18) / 2;
  fillCard(ctx, box.contentX, box.contentY, halfW, 214, 14, '#FFFFFF', '#E2E8F0');
  ctx.fillStyle = '#0B1D3A';
  ctx.font = '700 15px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Inspect Full Profile & Approve Link (No Payment)', box.contentX + 20, box.contentY + 28);
  fillCard(ctx, box.contentX + 20, box.contentY + 42, halfW - 40, 62, 9, '#F8FAFC', '#CBD5E1');
  ctx.fillStyle = '#0B1D3A';
  ctx.font = '600 12px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Priya Deshmukh · /p/priya-deshmukh · Alt Mobile & Addresses Visible', box.contentX + 32, box.contentY + 66);
  ctx.fillStyle = '#059669';
  ctx.font = '500 11px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Payment Status: Pending  ·  Manual Admin Approval: ACTIVE', box.contentX + 32, box.contentY + 88);
  drawButton(ctx, box.contentX + 20, box.contentY + 118, 118, 34, 'Inspect Profile', '#0B1D3A', '#FFFFFF', 11);
  drawButton(ctx, box.contentX + 146, box.contentY + 118, 126, 34, 'Mark Paid', '#059669', '#FFFFFF', 11);
  drawButton(ctx, box.contentX + 280, box.contentY + 118, 118, 34, 'Disable Link', '#E11D48', '#FFFFFF', 11);
  drawButton(ctx, box.contentX + 20, box.contentY + 162, 134, 34, 'Open /p/:slug', '#EEF2FF', '#1D4ED8', 12);

  const rightX = box.contentX + halfW + 18;
  fillCard(ctx, rightX, box.contentY, halfW, 214, 14, '#FFFFFF', '#E2E8F0');
  ctx.fillStyle = '#0B1D3A';
  ctx.font = '700 15px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Payment Gateways & Test Connection', rightX + 20, box.contentY + 28);
  const gws = [
    ['Razorpay (Sandbox)', true],
    ['Cashfree (Sandbox)', true],
    ['Easebuzz (Sandbox)', false],
    ['PayU India (Sandbox)', false],
    ['Google Pay / GPay', true],
    ['Direct UPI Intent', true],
  ] as const;
  gws.forEach(([label, on], idx) => {
    const gx = rightX + 20 + (idx % 2) * 212;
    const gy = box.contentY + 46 + Math.floor(idx / 2) * 40;
    fillCard(ctx, gx, gy, 200, 32, 8, '#F8FAFC', '#E2E8F0');
    fillCard(ctx, gx + 10, gy + 7, 17, 17, 4, on ? '#1D4ED8' : '#FFFFFF', on ? '#1D4ED8' : '#94A3B8');
    if (on) {
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '700 11px sans-serif';
      ctx.fillText('✓', gx + 14, gy + 19);
    }
    ctx.fillStyle = '#0F172A';
    ctx.font = '500 11px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(label, gx + 36, gy + 20);
  });
  drawButton(ctx, rightX + 20, box.contentY + 168, 174, 32, 'Save Gateway Settings', '#0B1D3A', '#FFFFFF', 11);
  drawButton(ctx, rightX + 204, box.contentY + 168, 150, 32, 'Test Connection ✓', '#ECFDF5', '#047857', 11);

  // Bottom: Filter-First Security Audit Logs + Orders/CSV Bar
  const logY = box.contentY + 228;
  const logH = box.contentH - 228;
  fillCard(ctx, box.contentX, logY, box.contentW, logH, 14, '#FFFFFF', '#E2E8F0');
  ctx.fillStyle = '#0B1D3A';
  ctx.font = '700 15px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Security Audit Logs (Displayed Upon Filter Selection)  ·  Orders, Payments & CSV Reports', box.contentX + 20, logY + 28);

  const filters = ['Range: Custom From–To', 'From: 2026-11-01', 'To: 2026-11-21', 'Role: ALL', 'Keyword: approve'];
  filters.forEach((f, idx) => {
    const fx = box.contentX + 20 + idx * 156;
    fillCard(ctx, fx, logY + 44, 146, 34, 8, '#F8FAFC', '#CBD5E1');
    ctx.fillStyle = '#0F172A';
    ctx.font = '500 11px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(f, fx + 10, logY + 65);
  });
  drawButton(ctx, box.contentX + box.contentW - 150, logY + 44, 130, 34, 'Apply Filter', '#1D4ED8', '#FFFFFF', 12);

  const logRows = [
    ['ADMIN_APPROVE_PROFILE', 'ADMIN', 'profiles/prof_88', 'Approved public link /p/priya-deshmukh without payment'],
    ['SAVE_PAYMENT_GATEWAYS', 'SUPERADMIN', 'appSettings/global', 'Enabled Razorpay, Cashfree, Google Pay, UPI'],
    ['ORDER_DISPATCHED', 'PRINTER', 'orders/ord_83910', 'BlueDart AWB BD992014451IN'],
  ];
  logRows.forEach(([act, role, tgt, det], idx) => {
    const ry = logY + 92 + idx * 44;
    fillCard(ctx, box.contentX + 20, ry, box.contentW - 40, 36, 8, idx % 2 === 0 ? '#F8FAFC' : '#FFFFFF', '#E2E8F0');
    ctx.fillStyle = '#0B1D3A';
    ctx.font = '700 11px "JetBrains Mono", monospace';
    ctx.fillText(act, box.contentX + 34, ry + 22);
    ctx.fillStyle = '#1D4ED8';
    ctx.fillText(role, box.contentX + 250, ry + 22);
    ctx.fillStyle = '#475569';
    ctx.font = '500 11px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(`${tgt}  ·  ${det}`, box.contentX + 356, ry + 22);
  });

  drawCalloutPin(ctx, box.contentX + 346, box.contentY + 114, 1);
  drawCalloutPin(ctx, rightX + 360, box.contentY + 26, 2);
  drawCalloutPin(ctx, box.contentX + box.contentW - 100, logY + 40, 3);
  drawCalloutPin(ctx, box.contentX + 460, box.contentY + 170, 4);
}

function drawSceneSuperAdminRbacQrReset(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  logoImg: HTMLImageElement | null
) {
  const topY = drawBrowserChrome(ctx, w, h, '/superadmin/system-settings?tab=gateways');
  const box = drawPortalShell(
    ctx,
    w,
    h,
    topY,
    'SuperAdmin Control',
    'Gateways & System Settings Control Plane',
    [
      'SuperAdmin Overview',
      'Roles & Permissions',
      'Profiles, Orders & Designs',
      'URL QR Generator',
      'Gateways & System Settings',
      'User Guide (PDF)',
    ],
    4,
    logoImg
  );

  const halfW = (box.contentW - 18) / 2;

  // Top-Left: Grouped Roles & Permissions Matrix
  fillCard(ctx, box.contentX, box.contentY, halfW, 232, 14, '#FFFFFF', '#E2E8F0');
  ctx.fillStyle = '#0B1D3A';
  ctx.font = '700 15px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Grouped Roles & Admin Permissions Hub', box.contentX + 20, box.contentY + 28);
  ['ops.lead@tapnex.in  →  ADMIN', 'apex.press@print.in  →  PRINTER'].forEach((u, i) => {
    const uy = box.contentY + 44 + i * 42;
    fillCard(ctx, box.contentX + 20, uy, halfW - 40, 34, 8, '#F8FAFC', '#E2E8F0');
    ctx.fillStyle = '#0F172A';
    ctx.font = '600 12px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(u, box.contentX + 34, uy + 21);
  });
  const perms = ['Manage Users ✓', 'Approve Profiles ✓', 'Verify Payments ✓', 'Audit Logs ✓', 'Edit Templates ✓', 'Payment Gateways ✓'];
  perms.forEach((p, idx) => {
    const px = box.contentX + 20 + (idx % 2) * 212;
    const py = box.contentY + 144 + Math.floor(idx / 2) * 28;
    ctx.fillStyle = '#1D4ED8';
    ctx.font = '600 12px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(p, px, py);
  });

  // Top-Right: Direct Public URL QR Generator
  const rightX = box.contentX + halfW + 18;
  fillCard(ctx, rightX, box.contentY, halfW, 232, 14, '#FFFFFF', '#E2E8F0');
  ctx.fillStyle = '#0B1D3A';
  ctx.font = '700 15px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Direct Public URL QR Generator (1024px / SVG)', rightX + 20, box.contentY + 28);
  fillCard(ctx, rightX + 20, box.contentY + 46, halfW - 170, 34, 8, '#F8FAFC', '#CBD5E1');
  ctx.fillStyle = '#0F172A';
  ctx.font = '500 12px "JetBrains Mono", monospace';
  ctx.fillText('https://tapnex.in/p/jeet', rightX + 30, box.contentY + 67);
  drawButton(ctx, rightX + halfW - 140, box.contentY + 46, 120, 34, 'Generate QR', '#0B1D3A', '#FFFFFF', 12);
  drawMiniQr(ctx, rightX + 20, box.contentY + 96, 114);
  drawButton(ctx, rightX + 154, box.contentY + 108, 150, 34, 'Download 1024px PNG', '#EEF2FF', '#1D4ED8', 11);
  drawButton(ctx, rightX + 154, box.contentY + 154, 150, 34, 'Download SVG Vector', '#EEF2FF', '#1D4ED8', 11);

  // Bottom-Left: 6 Payment Gateways Checkboxes & Pricing Policies
  const botY = box.contentY + 248;
  const botH = box.contentH - 248;
  fillCard(ctx, box.contentX, botY, halfW, botH, 14, '#FFFFFF', '#E2E8F0');
  ctx.fillStyle = '#0B1D3A';
  ctx.font = '700 15px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Payment Gateways (6 Providers) & Pricing Tabs', box.contentX + 20, botY + 28);
  const sysRows = [
    '☑ Razorpay   ☑ Cashfree   ☑ Easebuzz   ☐ PayU   ☑ GPay   ☑ UPI',
    'Base Price: ₹999  ·  GST: 18%  ·  Shipping: ₹99  ·  Mode: Sandbox/Live',
    'Private Secrets & Salts Stay in Server .env (Zero Client Exposure)',
  ];
  sysRows.forEach((line, idx) => {
    fillCard(ctx, box.contentX + 20, botY + 46 + idx * 42, halfW - 40, 34, 8, '#F8FAFC', '#E2E8F0');
    ctx.fillStyle = idx === 0 ? '#1D4ED8' : '#0F172A';
    ctx.font = `${idx === 0 ? '600' : '500'} 11px "Plus Jakarta Sans", sans-serif`;
    ctx.fillText(line, box.contentX + 32, botY + 67 + idx * 42);
  });
  drawButton(ctx, box.contentX + 20, botY + botH - 46, 188, 34, 'Save Gateway & Policy Config', '#0B1D3A', '#FFFFFF', 11);

  // Bottom-Right: Danger Zone Factory Reset
  fillCard(ctx, rightX, botY, halfW, botH, 14, '#FFF1F2', '#FECDD3');
  ctx.fillStyle = '#9F1239';
  ctx.font = '700 15px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Danger Zone Tab: Clear All Data & Reset App', rightX + 20, botY + 28);
  ctx.fillStyle = '#475569';
  ctx.font = '400 12px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Clears all orders, payments, designs, profiles, QR codes, printers,', rightX + 20, botY + 54);
  ctx.fillText('tickets, audit logs, and local drafts. Active SuperAdmin stays signed in.', rightX + 20, botY + 72);

  fillCard(ctx, rightX + 20, botY + 92, halfW - 40, 34, 8, '#FFFFFF', '#FDA4AF');
  ctx.fillStyle = '#881337';
  ctx.font = '700 13px "JetBrains Mono", monospace';
  ctx.fillText('Confirm: RESET', rightX + 32, botY + 114);
  drawButton(ctx, rightX + 20, botY + botH - 48, halfW - 40, 36, 'Clear All Data & Reset App', '#E11D48', '#FFFFFF', 13);

  drawCalloutPin(ctx, box.contentX + 380, box.contentY + 26, 1);
  drawCalloutPin(ctx, rightX + halfW - 36, box.contentY + 26, 2);
  drawCalloutPin(ctx, box.contentX + 380, botY + 26, 3);
  drawCalloutPin(ctx, rightX + halfW - 36, botY + 26, 4);
}

export async function renderGuideScreenshotDataUrl(sceneId: ScreenshotSceneId): Promise<string> {
  const cached = screenshotCache.get(sceneId);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 760;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const logoImg = await getTapNexLogo();

  switch (sceneId) {
    case 'public_landing_and_profile':
      drawScenePublicLandingAndProfile(ctx, canvas.width, canvas.height, logoImg);
      break;
    case 'customer_profile_visibility':
      drawSceneCustomerProfileVisibility(ctx, canvas.width, canvas.height, logoImg);
      break;
    case 'customer_card_studio':
      drawSceneCustomerCardStudio(ctx, canvas.width, canvas.height, logoImg);
      break;
    case 'customer_checkout_fulfilment':
      drawSceneCustomerCheckoutFulfilment(ctx, canvas.width, canvas.height, logoImg);
      break;
    case 'printer_production_dispatch':
      drawScenePrinterProductionDispatch(ctx, canvas.width, canvas.height, logoImg);
      break;
    case 'admin_approved_print_templates':
      drawSceneAdminApprovedPrintTemplates(ctx, canvas.width, canvas.height, logoImg);
      break;
    case 'admin_orders_audit_logs':
      drawSceneAdminOrdersAuditLogs(ctx, canvas.width, canvas.height, logoImg);
      break;
    case 'superadmin_rbac_qr_reset':
      drawSceneSuperAdminRbacQrReset(ctx, canvas.width, canvas.height, logoImg);
      break;
  }

  const dataUrl = canvas.toDataURL('image/png');
  screenshotCache.set(sceneId, dataUrl);
  return dataUrl;
}
