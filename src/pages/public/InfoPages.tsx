import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Smartphone, Shield, Truck } from 'lucide-react';
import { PublicLayout } from '../../components/PublicLayout';
import { SmartCardLink } from '../../components/SmartCardLink';
import { CardCanvasPreview } from '../../components/CardCanvasPreview';
import { DEFAULT_CARD_TEMPLATES } from '../../lib/constants';
import { getCardTemplates } from '../../lib/firestoreService';
import { useToast } from '../../contexts/ToastContext';
import type { CardTemplateRecord } from '../../types';

const SAMPLE_INFO = {
  fullName: 'Your Name',
  jobTitle: 'Your Designation',
  companyName: 'Your Company Name',
  mobile: 'Your Number',
  email: 'Your Email ID',
  website: 'Your Website',
};

export const HowItWorksPage: React.FC = () => (
  <PublicLayout>
    <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <h1 className="font-display text-3xl sm:text-4xl font-bold text-[#0B1D3A] tracking-tight">
        How TapNex Works
      </h1>
      <p className="mt-3 text-slate-600 max-w-2xl">
        A unified hardware and software workflow engineered for reliable tap-and-scan contact exchange.
      </p>
      <div className="mt-10 space-y-6">
        {[
          { step: 'Step 1', title: 'Create your digital business profile', text: 'Register with Google or email/password, verify your account, and enter your contact numbers, WhatsApp, bio, and 16+ social platforms. Toggle visibility per field.' },
          { step: 'Step 2', title: 'Customize your business card', text: 'Use an 85.6 × 54 mm predefined template or design your own front and back layout. A placeholder indicates exact QR placement prior to purchase.' },
          { step: 'Step 3', title: 'Purchase your SMART card', text: 'Approve your final layout, provide your Indian shipping address, and complete payment securely via Razorpay or enabled gateways.' },
          { step: 'Step 4', title: 'Production, QR embedding & SMART encoding', text: 'After payment verification, our backend generates your unique QR code, exports a 300 DPI print-ready PDF with 3 mm bleed, and assigns a verified print partner to encode and ship your card within 10–15 days.' },
          { step: 'Step 5', title: 'Share via SMART tap or QR scan', text: 'Compatible smartphones read your profile URL from the embedded SMART chip, while any camera can scan the fallback QR code.' },
        ].map((s) => (
          <div key={s.step} className="bg-white border border-slate-200 rounded-2xl p-6 flex flex-col sm:flex-row gap-4">
            <span className="font-mono text-sm font-bold text-[#1D4ED8] shrink-0 w-20">{s.step}</span>
            <div>
              <h2 className="font-display text-lg font-bold text-[#0B1D3A]">{s.title}</h2>
              <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{s.text}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-10">
        <SmartCardLink className="inline-flex items-center gap-2 px-6 py-3 bg-[#0B1D3A] text-white rounded-xl text-sm font-semibold">
          <span>Get Your Smart Card</span>
          <ArrowRight className="h-4 w-4" />
        </SmartCardLink>
      </div>
    </section>
  </PublicLayout>
);

export const FeaturesPage: React.FC = () => (
  <PublicLayout>
    <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <h1 className="font-display text-3xl sm:text-4xl font-bold text-[#0B1D3A] tracking-tight">
        Platform Features
      </h1>
      <p className="mt-3 text-slate-600 max-w-2xl">
        Complete control over your public digital identity, card artwork specifications, and order fulfilment.
      </p>
      <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { title: 'One-Tap SMART Sharing', desc: 'Encoded NTAG215 SMART chip URL resolves immediately on tap-capable iOS and Android devices.' },
          { title: 'Universal QR Fallback', desc: 'High-contrast, error-correction-H QR code printed cleanly for devices without tap hardware.' },
          { title: 'One-Click vCard (.vcf)', desc: 'Generates standard vCard 3.0 downloads containing only your publicly visible fields.' },
          { title: 'Field-by-Field Privacy', desc: 'Independently show or hide mobile, alternate email, address, social links, and custom fields.' },
          { title: '300 DPI Print Studio', desc: 'Exact 85.6 × 54 mm trim size, 3 mm bleed, safe margins, and crop marks.' },
          { title: 'Live Instant Edits', desc: 'Change designations, links, or phone numbers anytime without reprinting physical cards.' },
        ].map((f) => (
          <div key={f.title} className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className="font-display text-lg font-bold text-[#0B1D3A]">{f.title}</h2>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </div>
    </section>
  </PublicLayout>
);

export const CardDesignsPage: React.FC = () => {
  const [templates, setTemplates] = useState<CardTemplateRecord[]>(
    DEFAULT_CARD_TEMPLATES.filter((t) => t.active)
  );
  useEffect(() => {
    getCardTemplates().then(setTemplates);
  }, []);

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10">
          <div>
            <h1 className="font-display text-3xl sm:text-4xl font-bold text-[#0B1D3A] tracking-tight">
              Card Design Templates
            </h1>
            <p className="mt-2 text-slate-600">
              All designs adhere to ISO/IEC 7810 ID-1 (85.6 × 54 mm) with 3 mm print bleed.
            </p>
          </div>
          <SmartCardLink className="px-5 py-2.5 bg-[#0B1D3A] text-white rounded-xl text-sm font-semibold whitespace-nowrap">
            Customize in Studio
          </SmartCardLink>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {templates.map((tpl) => (
            <div key={tpl.templateId} className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="font-display font-bold text-[#0B1D3A]">{tpl.name}</h2>
                    <p className="text-xs text-slate-500">{tpl.cardType || tpl.category}</p>
                  </div>
                  <span className="font-mono font-bold text-sm text-[#1D4ED8] tabular-nums">₹{tpl.priceInr}</span>
                </div>
                <CardCanvasPreview side={tpl.frontSpec} orientation="landscape" personalInfo={SAMPLE_INFO} />
              </div>
              <SmartCardLink
                className="mt-5 block text-center py-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm font-semibold text-[#0B1D3A]"
              >
                Use This Template
              </SmartCardLink>
            </div>
          ))}
        </div>
      </section>
    </PublicLayout>
  );
};

export const PricingPage: React.FC = () => (
  <PublicLayout>
    <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <h1 className="font-display text-3xl sm:text-4xl font-bold text-[#0B1D3A] tracking-tight">
        Simple, Transparent Pricing
      </h1>
      <p className="mt-3 text-slate-600">
        Includes lifetime digital profile hosting, unlimited edits, QR fallback, and tracked pan-India courier delivery within 10–15 days.
      </p>
      <div className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[
          {
            tier: 'Minimal Design (QR Only)',
            price: '₹499',
            desc: 'Clean minimal card with instant QR code scan and live digital profile.',
            items: ['Basic minimal layout + custom QR', 'Field-level privacy controls', 'Lifetime hosted profile & vCard download'],
          },
          {
            tier: 'Designer Card (QR Only)',
            price: '₹599',
            desc: 'Custom designer artwork card printed with high-contrast QR code.',
            items: ['Designer front & back layouts', 'Custom logo, fonts & shapes', 'Pan-India tracked delivery'],
          },
          {
            tier: 'Minimal Design (QR + Smart Card)',
            price: '₹999',
            desc: 'Minimal PVC card equipped with both embedded NFC Smart chip and QR fallback.',
            items: ['One-tap NTAG215 NFC + QR scan', 'ISO/IEC 7810 ID-1 300 DPI print', 'Instant edits without reprinting'],
          },
          {
            tier: 'Designer Card (QR + Smart Card)',
            price: '₹1,499',
            desc: 'Signature executive designer card with full-bleed artwork, QR, and NFC Smart chip.',
            items: ['Designer template + NFC Smart chip', 'Priority 300 DPI print partner routing', 'Ideal for executives & teams'],
          },
          {
            tier: 'Dog Tags (Pack of 2)',
            price: '₹599',
            desc: 'Two durable pet recovery QR tags ready to clip onto your dog collar.',
            items: ['Includes 2 printed Dog Tags', 'Collar belt not included', 'Pre-filled pet name, owner phone & vet notes'],
          },
          {
            tier: 'Helmet QR Stickers (Pack of 2)',
            price: '₹299',
            desc: 'Emergency SOS sticker pack built for riders — one for Helmet and one for Bike.',
            items: ['Includes 2 weatherproof QR stickers', '1 sticker for Helmet + 1 sticker for Bike', 'Shows Blood Group & SOS emergency contacts'],
          },
        ].map((p) => (
          <div key={p.tier} className="bg-white border border-slate-200 rounded-2xl p-6 flex flex-col justify-between">
            <div>
              <h2 className="font-display text-lg font-bold text-[#0B1D3A]">{p.tier}</h2>
              <div className="mt-2 font-display text-3xl font-bold text-[#1D4ED8] tabular-nums">{p.price}</div>
              <p className="mt-2 text-sm text-slate-600">{p.desc}</p>
              <ul className="mt-5 space-y-2 text-sm text-slate-700">
                {p.items.map((it) => (
                  <li key={it} className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </div>
            <SmartCardLink className="mt-6 block text-center py-2.5 bg-[#0B1D3A] text-white rounded-xl text-sm font-semibold">
              Order Now
            </SmartCardLink>
          </div>
        ))}
      </div>
    </section>
  </PublicLayout>
);

export const FaqPage: React.FC = () => (
  <PublicLayout>
    <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <h1 className="font-display text-3xl font-bold text-[#0B1D3A]">Frequently Asked Questions</h1>
      <div className="mt-8 space-y-4">
        {[
          { q: 'Does every smartphone support SMART tapping?', a: 'Most modern iPhones (XS and newer) and Android phones with contactless tap enabled support tap-to-open. For older or tap-disabled phones, the printed QR code provides universal access.' },
          { q: 'Can I customize my public profile URL?', a: 'Yes, you can choose any available slug such as /p/your-name from your Customer Portal.' },
          { q: 'Can I edit my card design after payment?', a: 'Once payment is verified, your design is locked for printing accuracy. If you need post-purchase changes, submit a Design Revision ticket in Help & Support.' },
          { q: 'What is the delivery timeline?', a: 'Standard delivery across India takes 10–15 days from payment verification.' },
        ].map((item) => (
          <div key={item.q} className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className="font-display font-bold text-[#0B1D3A]">{item.q}</h2>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">{item.a}</p>
          </div>
        ))}
      </div>
    </section>
  </PublicLayout>
);

export const NfcGuidePage: React.FC = () => (
  <PublicLayout>
    <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-[#0B1D3A]">Smartcard Compatibility & Testing Guide</h1>
        <p className="mt-2 text-slate-600">
          Understanding how SMART tap and QR fallback work across iPhone and Android devices.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <Smartphone className="h-6 w-6 text-[#1D4ED8] mb-3" />
          <h2 className="font-display font-bold text-[#0B1D3A]">Apple iPhone</h2>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed">
            iPhone XS / XR and newer support background SMART card reading automatically—tap the card near the top edge of the phone. Older iPhones can scan the fallback QR code with the native Camera app.
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <Shield className="h-6 w-6 text-[#1D4ED8] mb-3" />
          <h2 className="font-display font-bold text-[#0B1D3A]">Android Smartphones</h2>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed">
            Ensure contactless tap / SMART reading is turned on in Settings → Connected Devices. Hold the card steady against the upper-middle back of the phone. If tap reading is unavailable or disabled on a device, use the QR code fallback.
          </p>
        </div>
      </div>
    </section>
  </PublicLayout>
);

export const ContactPage: React.FC = () => {
  const { notify } = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.includes('@') || message.trim().length < 10) {
      notify('Incomplete inquiry', 'Please provide your name, a valid email, and at least 10 characters.', 'error');
      return;
    }
    setSent(true);
    notify('Inquiry received', 'Our team will respond to your email within 1 business day.', 'success');
  };

  return (
    <PublicLayout>
      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h1 className="font-display text-3xl font-bold text-[#0B1D3A]">Contact TapNex</h1>
        <p className="mt-2 text-slate-600">Questions about corporate bulk cards, print partnerships, or order support?</p>
        {sent ? (
          <div className="mt-8 bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-emerald-900">
            <h2 className="font-display font-bold text-lg">Thank you for reaching out</h2>
            <p className="mt-1 text-sm">We have logged your message for {email}. Support email: support@tapnex.in.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-8 bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm"
                placeholder="Your full name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Work Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm"
                placeholder="you@company.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Message</label>
              <textarea
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm"
                placeholder="Tell us about your team size or inquiry..."
              />
            </div>
            <button type="submit" className="px-6 py-2.5 bg-[#0B1D3A] text-white text-sm font-semibold rounded-lg">
              Send Message
            </button>
          </form>
        )}
      </section>
    </PublicLayout>
  );
};

export const LegalDocPage: React.FC<{ type: 'privacy' | 'terms' | 'refund' }> = ({ type }) => {
  const title =
    type === 'privacy'
      ? 'Privacy Policy'
      : type === 'terms'
        ? 'Terms of Service'
        : 'Refund & Cancellation Policy';

  return (
    <PublicLayout>
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 space-y-6">
        <h1 className="font-display text-3xl font-bold text-[#0B1D3A]">{title}</h1>
        <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-4 text-sm text-slate-600 leading-relaxed">
          {type === 'privacy' && (
            <>
              <p>TapNex isolates private customer account data from public business profiles. Only fields explicitly checked in your Public Profile Visibility Settings are published to your public URL or included in generated vCard (.vcf) downloads.</p>
              <p>Payment processing is performed server-side via Razorpay without storing raw card details on our servers.</p>
            </>
          )}
          {type === 'terms' && (
            <>
              <p>By approving a card design in the Design Studio, you confirm that all names, contact details, and logos are accurate for 300 DPI print production (85.6 × 54 mm).</p>
              <p>Post-purchase revisions require submitting a support request before the assigned printer begins production.</p>
            </>
          )}
          {type === 'refund' && (
            <>
              <p>Orders may be cancelled for a full refund before printer production starts. Customized SMART cards already printed or dispatched cannot be cancelled unless damaged or defective upon delivery.</p>
              <p className="flex items-center gap-2 font-medium text-slate-800">
                <Truck className="h-4 w-4 text-[#1D4ED8]" />
                <span>Standard delivery across India takes 10–15 days from payment verification.</span>
              </p>
            </>
          )}
        </div>
      </section>
    </PublicLayout>
  );
};
