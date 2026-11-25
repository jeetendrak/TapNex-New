export type GuideRoleId = 'public' | 'customer' | 'printer' | 'admin' | 'superadmin';

export type ScreenshotSceneId =
  | 'public_landing_and_profile'
  | 'customer_profile_visibility'
  | 'customer_card_studio'
  | 'customer_checkout_fulfilment'
  | 'printer_production_dispatch'
  | 'admin_approved_print_templates'
  | 'admin_orders_audit_logs'
  | 'superadmin_rbac_qr_reset';

export interface ScreenshotCallout {
  num: number;
  title: string;
  detail: string;
}

export interface GuideFeatureSection {
  id: string;
  title: string;
  route: string;
  summary: string;
  screenshotId: ScreenshotSceneId;
  screenshotCaption: string;
  callouts: ScreenshotCallout[];
  steps: string[];
  notes: string[];
}

export interface RoleGuideSpec {
  roleId: GuideRoleId;
  roleTitle: string;
  roleCode: string;
  portalPath: string;
  audience: string;
  overview: string;
  features: GuideFeatureSection[];
}

export interface RoleCapabilityRow {
  roleId?: GuideRoleId;
  role: string;
  accessLevel: string;
  portalEntry: string;
  primaryWorkflows: string;
}

export const ROLE_CAPABILITY_MATRIX: RoleCapabilityRow[] = [
  {
    roleId: 'public',
    role: 'Public Visitor',
    accessLevel: 'No Login Required',
    portalEntry: '/ and /p/:slug',
    primaryWorkflows:
      'Browse card designs & pricing, tap SMART card or scan QR to open /p/:slug without signing in, download vCard (.vcf), connect via WhatsApp/Socials under Connect Online, or Call/Email.',
  },
  {
    roleId: 'customer',
    role: 'Customer (USER)',
    accessLevel: 'Verified Email / Google Sign-In',
    portalEntry: '/dashboard',
    primaryWorkflows:
      'Create profiles from Overview or My Profile, use Rich Text Bio editor, mark payment completed to unmask/activate /p/:slug, design blank/preset cards (multi-select, 6-way align, snap guides, borders, color palette, arrow nudge, transparent PNG), pay via 6 gateways, track Orders.',
  },
  {
    roleId: 'printer',
    role: 'Print Partner (PRINTER)',
    accessLevel: 'Admin-Onboarded Printer UID',
    portalEntry: '/printer/dashboard',
    primaryWorkflows:
      'View assigned orders, export 1:1 WYSIWYG 300 DPI print-ready PDF (with 3mm bleed & crop marks) and 1024px QR, encode SMART chip URL, advance production, dispatch via courier.',
  },
  {
    roleId: 'admin',
    role: 'Operations Admin (ADMIN)',
    accessLevel: 'Assigned by SuperAdmin',
    portalEntry: '/admin/dashboard',
    primaryWorkflows:
      'Use grouped 6-item hubs to manage Users, Profiles & Printers, inspect full customer profile data, approve/mark payment completed or Disable/Enable /p/:slug links, test & toggle 6 payment gateways, Send Approved Designs to Print, and filter audit logs.',
  },
  {
    roleId: 'superadmin',
    role: 'SuperAdmin (SUPERADMIN)',
    accessLevel: 'Root Governance Role',
    portalEntry: '/superadmin/dashboard',
    primaryWorkflows:
      'Assign ADMIN/PRINTER roles & permissions, inspect/approve/disable profiles, configure, test & toggle 6 payment gateways (Razorpay, Cashfree, Easebuzz, PayU, Google Pay, UPI), generate direct URL QRs, tune INR/GST, and run Factory Reset.',
  },
];

export const ROLE_GUIDES: RoleGuideSpec[] = [
  {
    roleId: 'public',
    roleTitle: 'Public Visitor & Card Recipient',
    roleCode: 'PUBLIC',
    portalPath: '/ and /p/:slug',
    audience: 'Prospects, networking contacts, and SMART/QR scanners',
    overview:
      'Anyone who visits the TapNex storefront or taps a physical SMART business card (or scans its fallback QR code) lands on a fast, login-free experience at /p/:slug tailored for instant contact exchange with screen-capture protection.',
    features: [
      {
        id: 'public-profile-page',
        title: 'Live Digital Business Profile & Marketing Site (No Login Required)',
        route: '/p/:slug · /card-designs · /pricing · /nfc-guide',
        summary:
          'When a recipient taps a SMART card or scans its QR code, /p/:slug opens directly without any sign-in prompt and renders only fields allowed by the owner once payment is completed or Admin-approved (unless disabled by Admin).',
        screenshotId: 'public_landing_and_profile',
        screenshotCaption:
          'Public Digital Profile (/p/:slug) showing prominent TapNex logo, cropped avatar, rich biography, one-tap vCard download, WhatsApp under Connect Online, and screen protection.',
        callouts: [
          {
            num: 1,
            title: 'Prominent Brand Header & Share Action',
            detail:
              'Displays the high-contrast TapNex Smart Connections logo alongside a native Share button for copying or sharing the /p/:slug link.',
          },
          {
            num: 2,
            title: 'Profile Identity & Rich Formatted Biography',
            detail:
              'Shows the circular/transparent PNG auto-fitted avatar, full name, job title, company, and sanitized rich-text biography (bold, italic, underline, colors, alignment).',
          },
          {
            num: 3,
            title: 'One-Click Save Contact (.vcf) & Screen Protection',
            detail:
              'Generates a standards-compliant vCard 3.0 file containing strictly public fields while enforcing right-click, save, print, and screenshot watermark protection.',
          },
          {
            num: 4,
            title: 'Connect Online (WhatsApp & Socials) + Verified Contact Info',
            detail:
              'Lists mobile, email, website, addresses, custom fields, and places the clickable WhatsApp link neatly inside the Connect Online section alongside enabled social icons.',
          },
        ],
        steps: [
          'Tap the physical SMART card against the top edge of an iPhone (XS or newer) or back center of an Android phone, or scan the printed QR code.',
          'View the digital profile immediately at /p/:slug with zero login or app install required once payment is completed or Admin-approved.',
          'Tap Save Contact to download the .vcf file directly into your phone address book, or tap WhatsApp / Social icons under Connect Online for instant outreach.',
          'If a profile is awaiting payment, Admin-disabled, or paused, external visitors see a safe status gate instead of exposing private information.',
        ],
        notes: [
          'Unpaid profiles are blocked externally and watermarked/masked inside the portal until payment is completed or Admin-approved.',
          'Admins and SuperAdmins can disable or re-enable any /p/:slug link at any time, and screen-protection overlays blur/watermark attempts to right-click, save, or capture the profile.',
        ],
      },
    ],
  },
  {
    roleId: 'customer',
    roleTitle: 'Customer Portal (Card Owner)',
    roleCode: 'USER',
    portalPath: '/dashboard',
    audience: 'Professionals, founders, and teams creating SMART business cards',
    overview:
      'The Customer Portal uses a clean 6-item grouped sidebar (Overview, My Profile & Visibility, Design My Card, Orders & Tracking, Account & Support, User Guide) with profile creation, rich bio editing, full WYSIWYG card studio tools, and payment-gated public link unlocking.',
    features: [
      {
        id: 'customer-profile-visibility',
        title: 'Create Profile Anywhere, Rich Bio Editor, Watermarked Link & Privacy Hub',
        route: '/dashboard · /dashboard/profile · /dashboard/social-links · /dashboard/visibility',
        summary:
          'Create profiles from Overview OR directly on the My Profile page (+ Create Digital Profile), switch profiles using the top dropdown, format your Short Biography with bold/italic/underline/colors/alignment, and unlock your masked public profile link by marking payment completed.',
        screenshotId: 'customer_profile_visibility',
        screenshotCaption:
          'Grouped My Profile & Visibility hub showing + Create Digital Profile, Profile Dropdown, Rich Bio Editor, Watermarked Unpaid Link, and Visibility controls.',
        callouts: [
          {
            num: 1,
            title: 'Prominent + Create Digital Profile & Hub Tab Bar',
            detail:
              'Create a digital profile straight from Overview OR directly from the My Profile header/empty state, and access Social Links, Custom Fields, and Visibility in one hub.',
          },
          {
            num: 2,
            title: 'Watermarked Unpaid Link & Mark Payment Completed',
            detail:
              'Before payment, your public URL pill stays masked and watermarked in preview; click Mark Payment Completed (or complete checkout) to unlock the live /p/:slug link.',
          },
          {
            num: 3,
            title: 'Rich Text Biography Editor & Transparent PNG Cropper',
            detail:
              'Style Short Biography with Bold, Italic, Underline, alignment (L/C/R/J), and custom hex color palette; transparent PNG avatars keep transparency cleanly.',
          },
          {
            num: 4,
            title: 'Auto-Saved Social Links & Field Privacy Toggles',
            detail:
              'Configure social platforms (including WhatsApp under Connect Online) and control field-by-field visibility on /p/:slug.',
          },
        ],
        steps: [
          'Sign in via Google or verified Email/Password. Click + Create Digital Profile either on Dashboard Overview or directly on the My Profile page to set your Profile Label and Custom Slug.',
          'Upload a photo (transparent PNG backgrounds are preserved) and format your Short Biography using Bold, Italic, Underline, Alignment, and Text Color palette.',
          'Review your Public Profile Link pill: while payment is pending, it stays masked and watermarked. Click Mark Payment Completed or complete order checkout to activate /p/:slug.',
          'Switch to Social Links, Custom Fields, and Visibility tabs in the same hub to configure Connect Online links and field privacy toggles.',
        ],
        notes: [
          'Every save synchronizes private profiles/{profileId} and sanitized publicProfiles/{slug} atomically, and strips HTML tags cleanly inside exported .vcf contact notes.',
          'If an Admin disables your profile link, a banner notifies you inside My Profile and external visitors cannot access /p/:slug until re-enabled.',
        ],
      },
      {
        id: 'customer-card-studio',
        title: 'Pro Card Design Studio: Multi-Select, Alignment, Snap Guides & 1:1 Export',
        route: '/dashboard/card-design',
        summary:
          'Start from curated templates or upload front/back blank artwork, select multiple elements to align (Left/Center/Right/Top/Middle/Bottom), snap with live alignment guidelines, nudge with arrow keys (Ctrl+Arrow for 1pt precision), toggle card/avatar borders, and export distortion-free 300 DPI PDFs.',
        screenshotId: 'customer_card_studio',
        screenshotCaption:
          'Card Design Studio featuring Multi-Select 6-way Alignment, Snap Guidelines, Color Palette with Hex Paste, Border Controls, and 1:1 WYSIWYG Export.',
        callouts: [
          {
            num: 1,
            title: 'Multi-Select & 6-Way Alignment + Snap Guidelines',
            detail:
              'Hold Shift/Ctrl+Click (or select checkboxes) to pick multiple items and align Left, Center, Right, Top, Middle, or Bottom; live center/edge guidelines snap while dragging.',
          },
          {
            num: 2,
            title: 'Color Picker Palette (Auto-Saved History + Hex Paste)',
            detail:
              'Paste any #RRGGBB hex code directly or pick a color—used swatches automatically save into your reusable Color Palette across text, shapes, borders, and SMART icons.',
          },
          {
            num: 3,
            title: 'Arrow Key Nudging, Borders, Wrapping & Transparent PNGs',
            detail:
              'Move selected elements with Arrow keys (hold Ctrl+Arrow for 1-point precision), toggle Card & Avatar borders/thickness, wrap text inside Box Width %, and keep transparent PNG logos clear.',
          },
          {
            num: 4,
            title: '1:1 WYSIWYG Preview, PDF Download & Approve Design',
            detail:
              'Preview and downloaded 300 DPI print PDFs use the exact same shared geometry engine—eliminating cropped text or stretched elements.',
          },
        ],
        steps: [
          'Open Design My Card and pick a template (or upload your own Front/Back blank artwork). Insert profile fields or add custom text, shapes, logos, and QR/SMART icons.',
          'Use Shift/Ctrl+Click to multi-select items and align them via the 6-way alignment bar, drag with live snap guidelines, or nudge smoothly using Arrow keys and Ctrl+Arrow (1pt).',
          'Customize colors via hex paste or saved palette swatches, toggle Card/Avatar borders, adjust Box Width (%) for automatic word wrapping, and upload transparent PNGs cleanly.',
          'Click Preview Card or Download Proof PDF to verify 1:1 WYSIWYG rendering, then click Approve Design to unlock Checkout.',
        ],
        notes: [
          'Double-clicking any text item right on the card lets you edit its copy inline without hunting for sidebar inputs.',
          'Shared card layout geometry guarantees identical line wrapping, fonts, transparent PNGs, and spacing between screen preview and 300 DPI PDF downloads.',
        ],
      },
      {
        id: 'customer-checkout-fulfilment',
        title: 'Multi-Gateway Checkout & Grouped Orders & Tracking Hub',
        route: '/dashboard/checkout · /dashboard/orders · /dashboard/tracking · /dashboard/support',
        summary:
          'Complete GST-inclusive checkout across any admin-enabled payment gateway (Razorpay, Cashfree, Easebuzz, PayU, Google Pay, or UPI), then monitor all orders and live 12-step fulfilment under the unified Orders & Tracking link.',
        screenshotId: 'customer_checkout_fulfilment',
        screenshotCaption:
          'Grouped Orders & Tracking hub showing Multi-Gateway selector, My Orders | Order Tracking tab bar, 12-step fulfilment progress, and AWB tracking.',
        callouts: [
          {
            num: 1,
            title: '6 Configurable Payment Gateways at Checkout',
            detail:
              'Select from Razorpay, Cashfree, Easebuzz, PayU, Google Pay (GPay), or Direct UPI—only gateways enabled by your Admin/SuperAdmin appear here.',
          },
          {
            num: 2,
            title: 'Grouped Orders & Tracking Navigation + Tabs',
            detail:
              'Click "Orders & Tracking" in the sidebar (or visit /dashboard/tracking) and toggle cleanly between "My Orders" and "Order Tracking" with an order selector dropdown.',
          },
          {
            num: 3,
            title: '12-Step Fulfilment Timeline & Courier AWB',
            detail:
              'Follow every production stage from Design Pending and Payment Successful through Printing, Quality Check, Dispatched, and Delivered.',
          },
          {
            num: 4,
            title: 'Grouped Account & Support Hub',
            detail:
              'Access Account Security and Help & Support Tickets cleanly from the single "Account & Support" sidebar group.',
          },
        ],
        steps: [
          'From an approved design in Studio, click Proceed to Checkout, select card quantity, and confirm your Indian shipping address.',
          'Pick your preferred active payment gateway (Razorpay, Cashfree, Easebuzz, PayU, Google Pay, or Direct UPI) and complete verification.',
          'Open Orders & Tracking in the sidebar, select Order Tracking (or click Track on any order), and choose your order from the dropdown to inspect the 12-stage timeline.',
          'Use Account & Support -> Help & Support Tickets if you need a post-order revision or SMART setup assistance.',
        ],
        notes: [
          'Standard pan-India manufacturing and courier delivery timeline is 10–15 days from payment verification.',
          'Server endpoints validate HMAC signatures and payment records before unlocking verified orders.',
        ],
      },
    ],
  },
  {
    roleId: 'printer',
    roleTitle: 'Print Partner Portal',
    roleCode: 'PRINTER',
    portalPath: '/printer/dashboard',
    audience: 'Authorized printing and SMART encoding facilities',
    overview:
      'Print partners receive assigned, print-ready customer jobs complete with 1:1 WYSIWYG 300 DPI dual-sided PDFs, 1024px/SVG QR artwork, shipping labels, and fulfilment stage controls.',
    features: [
      {
        id: 'printer-production-dispatch',
        title: 'Print Queue, 300 DPI PDF Export & Courier Dispatch',
        route: '/printer/dashboard · /printer/orders/:orderId · /printer/profile',
        summary:
          'Dedicated production console displaying only orders assigned to the authenticated printer facility, with distortion-free 300 DPI print-ready PDF downloads and dispatch tracking.',
        screenshotId: 'printer_production_dispatch',
        screenshotCaption:
          'Printer Order Detail screen with 300 DPI PDF export, verified QR artwork, 12-step progress controls, and courier dispatch.',
        callouts: [
          {
            num: 1,
            title: 'Assigned Print Queue & Order Summary',
            detail:
              'Lists assigned orders with card material, quantity, SMART encoding target URL (/p/:slug), and customer shipping address.',
          },
          {
            num: 2,
            title: '300 DPI Print-Ready PDF & QR Downloads',
            detail:
              'Exports exact 85.6 x 54 mm (plus 3 mm bleed = 91.6 x 60 mm, 1082 x 709 px) front/back PDFs with crop marks, SMART icon slot, and embedded verified QR code.',
          },
          {
            num: 3,
            title: 'Production Stage Advancement',
            detail:
              'Move jobs forward cleanly across Assigned to Printer -> Printing in Progress -> Quality Check -> Ready for Dispatch -> In Transit -> Delivered.',
          },
          {
            num: 4,
            title: 'Courier Dispatch Form',
            detail:
              'Record Courier Name, Tracking Number, Tracking URL, and Dispatch Date—automatically updating the customer timeline and shipping ledger.',
          },
        ],
        steps: [
          'Log in to the Printer Portal and open Assigned Orders to inspect newly routed jobs.',
          'Open an order and download the 300 DPI Print-Ready PDF (with or without proof guides) along with standalone 1024px PNG/SVG QR files if needed.',
          'Encode the NTAG215 SMART chip with the displayed customer profile URL (/p/:slug) and update status to Printing in Progress -> Quality Check -> Ready for Dispatch.',
          'Once handed to the courier, enter Courier Name, Tracking Number, and Dispatch Date and click Mark Dispatched.',
        ],
        notes: [
          'Printers can only read and update orders explicitly assigned to their printerId; customer payment mutations are locked.',
          'Verify SMART chip readability and QR scan contrast during Quality Check before marking Ready for Dispatch.',
        ],
      },
    ],
  },
  {
    roleId: 'admin',
    roleTitle: 'Operations Admin Portal',
    roleCode: 'ADMIN',
    portalPath: '/admin/dashboard',
    audience: 'Operations managers overseeing users, profiles, designs, orders, and gateways',
    overview:
      'Admins operate from a streamlined 6-item grouped sidebar (Dashboard, Users/Profiles/Printers, Cards & Approved Designs, Orders/Payments/Shipping, Gateways/QR/Reports, User Guide) with instant hub tabs across every operational workflow.',
    features: [
      {
        id: 'admin-approved-templates',
        title: 'Cards & Approved Designs Hub, Template Visibility & Print Partners',
        route: '/admin/card-designs · /admin/approved-designs · /admin/printers',
        summary:
          'Manage card templates (enable/disable catalog checkboxes, set default template, upload front/back artwork, mouse-drag positioning), route approved customer designs straight to print, and onboard printing presses with auto Print Auth UIDs.',
        screenshotId: 'admin_approved_print_templates',
        screenshotCaption:
          'Grouped Cards & Approved Designs hub with Send to Print, Delete controls, Visual Template Editor, and Auto Print Auth IDs.',
        callouts: [
          {
            num: 1,
            title: 'Send Approved Design Directly to Print',
            detail:
              'Creates or updates the order, generates the 1024px QR artifact, locks the design, assigns a print partner, and initiates the 12-step timeline.',
          },
          {
            num: 2,
            title: 'Design Preview & Trash Bin Delete',
            detail:
              'Inspect exact Front & Back artwork (matching Studio design) or delete obsolete/test designs with confirmation.',
          },
          {
            num: 3,
            title: 'Visual Template Studio, Visibility Checkboxes & Default Picker',
            detail:
              'Control which templates appear in Customer Studio, set the default template, upload front/back artwork, toggle borders, and drag elements (including SMART wave icon) before saving.',
          },
          {
            num: 4,
            title: 'Print Partners Auto Auth ID',
            detail:
              'Grouped under Users, Profiles & Printers—automatically generates valid Print Auth UIDs when onboarding new printing press partners.',
          },
        ],
        steps: [
          'Open Cards & Approved Designs -> switch to Approved Designs to review customer-approved cards, inspect Front/Back artwork, or delete unwanted drafts.',
          'Click Send to Print on any approved design, choose quantity, pricing, payment status, Print Partner, and initial workflow stage, then confirm.',
          'Switch to the Card Templates tab to toggle visibility checkboxes, set the Default template, upload front/back art, and drag text/QR/SMART slots directly on the preview.',
          'Open Users, Profiles & Printers -> Printers tab to onboard press partners with auto-generated Print Auth UIDs and toggle active status.',
        ],
        notes: [
          'Sending an approved design to print automatically prepares the verified QR code so printers can download the 300 DPI PDF immediately.',
          'Every admin action (template edits, design deletions, direct print routing, payment updates) is recorded in Audit Logs.',
        ],
      },
      {
        id: 'admin-orders-audit',
        title: 'Profile Inspector, Mark Paid, Disable/Enable Link, Gateway Test & Audit Logs',
        route: '/admin/profiles · /admin/orders · /admin/settings · /admin/audit-logs',
        summary:
          'Inspect complete private customer profiles (with rich bio rendering), mark payment completed or approve /p/:slug links, disable/enable public links anytime, test & toggle 6 payment gateways, manage 12-step orders, and filter audit logs.',
        screenshotId: 'admin_orders_audit_logs',
        screenshotCaption:
          'Admin Profile Inspector (Mark Paid / Approve / Disable Link), 6-Gateway Enable Checkboxes + Test Connection, Order Overrides, and Audit Logs.',
        callouts: [
          {
            num: 1,
            title: 'Inspect Full Profile, Mark Paid & Disable/Enable Link',
            detail:
              'Inspect all private/public fields in Digital Profiles or User Detail, click Mark Paid or Approve Profile Link to unlock /p/:slug, or click Disable Link to block external access anytime.',
          },
          {
            num: 2,
            title: '6 Payment Gateways + Test Connection Verification',
            detail:
              'Under Gateways, QR & Reports -> Settings -> Payment Gateways, enable/disable Razorpay, Cashfree, Easebuzz, PayU, Google Pay, and UPI via checkboxes and click Test Connection to validate keys.',
          },
          {
            num: 3,
            title: 'Filter-First Security Audit Logs',
            detail:
              'Audit logs stay clean until you pick a preset (All, Last 24h, Last 7d, Last 30d, Custom From/To dates), Role, Action, or Keyword and click Apply Filter.',
          },
          {
            num: 4,
            title: 'Orders, Payments, Shipping & CSV Reports',
            detail:
              'Switch across grouped Orders, Payments & Shipping tabs to verify payments, assign printers, export CSV reports, or reply to support tickets.',
          },
        ],
        steps: [
          'Open Users, Profiles & Printers -> Digital Profiles (or View User) and click Inspect Profile to review formatted biography, contacts, addresses, and custom fields.',
          'Click Mark Paid or Approve Profile Link (No Payment) to unlock /p/:slug, or toggle Disable Link / Enable Link to revoke or restore public link access instantly.',
          'Open Gateways, QR & Reports -> Settings -> Payment Gateways, enable gateways, enter Public Key / App ID / UPI ID, click Test Connection to verify credentials, and Save Gateway Settings.',
          'Open Orders, Payments & Shipping for 12-step overrides or Gateways, QR & Reports -> Audit Logs to query activity by date, role, or keyword.',
        ],
        notes: [
          'Private gateway API secrets and salts stay strictly in server environment variables (.env) and are never stored in Firestore or exposed to browsers.',
          'Admin-disabled public links block /p/:slug immediately regardless of prior payment or approval state until re-enabled by an Admin/SuperAdmin.',
        ],
      },
    ],
  },
  {
    roleId: 'superadmin',
    roleTitle: 'SuperAdmin Control Plane',
    roleCode: 'SUPERADMIN',
    portalPath: '/superadmin/dashboard',
    audience: 'Platform owners with unrestricted governance, gateway & system reset control',
    overview:
      'SuperAdmins operate from a consolidated 6-item sidebar (SuperAdmin Overview, Roles & Permissions, Profiles/Orders/Designs, URL QR Generator, Gateways & System Settings, User Guide) with full control over RBAC, payment gateways, and factory reset.',
    features: [
      {
        id: 'superadmin-governance-reset',
        title: 'Roles & Permissions, Direct URL QR, 6 Payment Gateways & Factory Reset',
        route: '/superadmin/roles · /superadmin/permissions · /superadmin/qr-generator · /superadmin/system-settings',
        summary:
          'Manage administrator privileges in one grouped hub, generate standalone print-grade QR artwork for any URL, enable/configure all 6 payment gateways alongside INR/GST policies, or wipe test data back to blank.',
        screenshotId: 'superadmin_rbac_qr_reset',
        screenshotCaption:
          'SuperAdmin Control Plane showing grouped Roles & Permissions, Direct URL QR Generator, 6-Gateway Enable Checkboxes, and Danger Zone Reset.',
        callouts: [
          {
            num: 1,
            title: 'Grouped Roles & Admin Permissions Hub',
            detail:
              'Promote or demote accounts across USER, PRINTER, ADMIN, and SUPERADMIN (protecting the last active SuperAdmin) and toggle 9 modular admin capabilities from one hub.',
          },
          {
            num: 2,
            title: 'Direct Public URL QR Generator',
            detail:
              'Generate Error-Correction-H 1024px PNG & Vector SVG QR codes for any public URL directly without requiring a customer order.',
          },
          {
            num: 3,
            title: '6 Payment Gateways Checkboxes, Test Connection & Global Pricing',
            detail:
              'In Gateways & System Settings, toggle between Pricing & Global Policies and Payment Gateways (Razorpay, Cashfree, Easebuzz, PayU, Google Pay, UPI) and test each gateway connection.',
          },
          {
            num: 4,
            title: 'Danger Zone: Clear All Data & Reset App',
            detail:
              'Under the Danger Zone tab, type RESET to wipe all Firestore orders, payments, designs, profiles, QR codes, printers, tickets, audit logs, and local drafts while keeping your SuperAdmin active.',
          },
        ],
        steps: [
          'Open Roles & Permissions to promote team members to ADMIN or PRINTER, then switch to the Admin Permissions Matrix tab to toggle capability checkboxes.',
          'Use URL QR Generator to enter any public HTTPS URL and immediately download print-ready 1024px PNG or SVG vector artwork.',
          'Open Gateways & System Settings -> Payment Gateways tab to enable/disable gateways with checkboxes, configure Live/Sandbox public keys, click Test Connection, and save.',
          'Use the Pricing & Global Policies tab for GST/shipping rules, or open the Danger Zone tab and type RESET to return the workspace to a fresh blank state.',
        ],
        notes: [
          'Security rules prevent demoting the last active SuperAdmin, self-deleting your active SuperAdmin record during reset, or storing private gateway secrets in Firestore.',
          'Secondary email/password accounts created in Firebase Authentication can additionally be removed from Firebase Console -> Authentication -> Users.',
        ],
      },
    ],
  },
];
