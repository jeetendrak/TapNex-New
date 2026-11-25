import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  ChevronDown,
  Smartphone,
  QrCode,
  CreditCard,
  ShieldCheck,
  RefreshCw,
  Share2,
  Download,
} from 'lucide-react';
import { PublicLayout } from '../../components/PublicLayout';
import { CardCanvasPreview } from '../../components/CardCanvasPreview';
import {
  BLANK_CARD_TEMPLATE,
  DEFAULT_CARD_TEMPLATES,
  DEFAULT_SHOP_CATEGORIES,
  DEFAULT_SHOP_PRODUCTS,
} from '../../lib/constants';
import { getCardTemplates, getShopCategories, getShopProducts } from '../../lib/firestoreService';
import type { CardTemplateRecord, ShopCategoryRecord, ShopProductRecord } from '../../types';

const HERO_IMG = '/src/assets/images/hero_nfc_tap_1794820570201.jpg';
const SHOWCASE_IMG = '/src/assets/images/card_showcase_navy_1794820572938.jpg';
const WORKFLOW_IMG = '/src/assets/images/nfc_workflow_office_1794820571142.jpg';

const SAMPLE_PERSON = {
  fullName: 'Your Name',
  jobTitle: 'Your Designation',
  companyName: 'Your Company Name',
  mobile: 'Your Number',
  email: 'Your Email ID',
  website: 'Your Website',
};

const HOW_IT_WORKS_STEPS = [
  {
    step: '01',
    title: 'Create your digital business profile',
    desc: 'Add your contact numbers, WhatsApp, biography, social links, custom fields, and choose exactly which fields stay public or private.',
  },
  {
    step: '02',
    title: 'Customize your business card',
    desc: 'Pick a curated 85.6 × 54 mm template or customize colors, typography, logos, and front/back layout in our live design studio.',
  },
  {
    step: '03',
    title: 'Purchase your SMART card',
    desc: 'Approve your final layout, enter your Indian shipping address, and complete checkout securely.',
  },
  {
    step: '04',
    title: 'Receive your personalized smart card',
    desc: 'Our print partners produce your 300 DPI card with your unique QR code and encode the SMART chip before dispatching across India (10–15 days).',
  },
  {
    step: '05',
    title: 'Share your profile through SMART tap or QR scan',
    desc: 'Tap against compatible smartphones or scan the fallback QR code. Visitors view your mobile profile and save your vCard instantly.',
  },
];

const AUDIENCE_BENEFITS = [
  { role: 'Entrepreneurs', benefit: 'Update pitch decks, company links, and phone numbers in real time without reprinting a single card.' },
  { role: 'Business Owners', benefit: 'Standardize brand cards across leadership teams while controlling public and private contact visibility.' },
  { role: 'Freelancers', benefit: 'Link Behance, Dribbble, GitHub, and booking calendars straight from one physical card.' },
  { role: 'Sales Professionals', benefit: 'Put your WhatsApp and one-tap Save Contact button directly onto a prospect’s phone lock screen.' },
  { role: 'Consultants', benefit: 'Maintain separate personal and advisory profiles with custom appointment links and GST details.' },
  { role: 'Real Estate Agents', benefit: 'Share property listings, office addresses, and Google Business locations effortlessly on site visits.' },
  { role: 'Marketing Professionals', benefit: 'Track profile visits and direct engagement across campaigns with instant digital updates.' },
  { role: 'Corporate Employees', benefit: 'Replace disposable paper stock with durable ISO 7810 ID-1 PVC and metal hybrid SMART cards.' },
];

const FAQS = [
  {
    q: 'Do recipients need an app to view my SMART business card?',
    a: 'No. Modern iOS and Android smartphones open your public profile directly in the mobile browser via SMART tap or camera QR scan.',
  },
  {
    q: 'What happens if someone has a smartphone without SMART tap?',
    a: 'Every TapNex card includes a high-contrast, print-calibrated QR code on the card pointing to the exact same public profile URL as the SMART chip.',
  },
  {
    q: 'Can I update my phone number or job title after receiving my card?',
    a: 'Yes. Your card points to your permanent public profile URL. Any updates saved in your Customer Portal appear immediately without reprinting.',
  },
  {
    q: 'Why does the design studio show a QR placeholder before purchase?',
    a: 'To protect card authenticity and production integrity, actual scannable QR artwork is generated on our backend only after verified payment.',
  },
  {
    q: 'How long does delivery take within India?',
    a: 'Once your design is approved and payment is verified, printing, SMART chip encoding, quality checks, and courier delivery take 10–15 days across India.',
  },
];

export const HomePage: React.FC = () => {
  const initialDefault =
    DEFAULT_CARD_TEMPLATES.find((t) => t.isDefault) || DEFAULT_CARD_TEMPLATES[0];
  const [templates, setTemplates] = useState<CardTemplateRecord[]>(
    DEFAULT_CARD_TEMPLATES.filter((t) => t.active)
  );
  const [selectedTpl, setSelectedTpl] = useState<CardTemplateRecord>(initialDefault);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [featuredShopProducts, setFeaturedShopProducts] = useState<ShopProductRecord[]>(
    DEFAULT_SHOP_PRODUCTS.slice(0, 4)
  );
  const [shopCategories, setShopCategories] = useState<ShopCategoryRecord[]>(DEFAULT_SHOP_CATEGORIES);

  useEffect(() => {
    getCardTemplates().then((list) => {
      setTemplates(list);
      if (list.length > 0) {
        setSelectedTpl(list.find((t) => t.isDefault) || list[0]);
      } else {
        setSelectedTpl(BLANK_CARD_TEMPLATE);
      }
    });
    Promise.all([getShopProducts(false), getShopCategories(false)]).then(([prods, cats]) => {
      setShopCategories(cats);
      if (prods.length > 0) {
        setFeaturedShopProducts(prods.slice(0, 4));
      }
    });
  }, []);

  return (
    <PublicLayout>
      {/* 1. Hero Section */}
      <section className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 lg:py-20 grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-center">
            <h1
              className="font-display font-extrabold tracking-tight text-[#0B1D3A] leading-[1.08]"
              style={{ fontSize: 'clamp(2.25rem, 4vw, 3.6rem)', textWrap: 'balance' }}
            >
              Your Business Identity. One Smart Tap.
            </h1>
            <p className="mt-5 text-base sm:text-lg text-slate-600 leading-relaxed max-w-xl">
              Share your contact details, business information and social media profiles instantly with a premium SMART business card.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                to="/register"
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 text-sm font-semibold text-white bg-[#0B1D3A] hover:bg-[#132A52] rounded-xl transition-colors whitespace-nowrap"
              >
                <span>Get Your Smart Card</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/shop"
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 text-sm font-semibold text-[#0B1D3A] bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors whitespace-nowrap"
              >
                <span>Shop Smart Tags</span>
              </Link>
            </div>
            <div className="mt-8 pt-6 border-t border-slate-200 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500">
              <span>300 DPI Print + 3 mm Bleed</span>
              <span aria-hidden="true">·</span>
              <span>iOS & Android vCard Download</span>
              <span aria-hidden="true">·</span>
              <span>10–15 Days Pan-India Delivery</span>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="group relative h-full min-h-[300px] lg:min-h-[420px] rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 shadow-sm hover:shadow-xl hover:border-blue-300/80 transition-all duration-500">
              <img
                src={HERO_IMG}
                alt="Matte deep navy SMART business card tapped against a smartphone"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
              />
            </div>
          </div>
        </div>
      </section>

      {/* 2. How It Works */}
      <section id="how-it-works" className="py-16 lg:py-20 bg-slate-50 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#0B1D3A] tracking-tight">
              From Digital Profile to Physical SMART Card in Five Steps
            </h2>
            <p className="mt-3 text-slate-600 text-base">
              Every card is custom-manufactured to exact ISO dimensions and paired with your permanent public profile link.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-1 md:grid-cols-5 gap-5">
            {HOW_IT_WORKS_STEPS.map((item) => (
              <div
                key={item.step}
                className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between"
              >
                <div>
                  <span className="font-mono text-sm font-semibold text-[#1D4ED8] tabular-nums">
                    {item.step}.
                  </span>
                  <h3 className="mt-2 font-display text-base font-bold text-[#0B1D3A] leading-snug">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm text-slate-600 leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 3. Key Features (Asymmetric Bento Architecture) */}
      <section id="features" className="py-16 lg:py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-10">
            <div>
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#0B1D3A] tracking-tight">
                Engineered for Instant Sharing and Privacy Control
              </h2>
              <p className="mt-2 text-slate-600 max-w-2xl">
                Built on field-level visibility rules so you decide exactly what visitors and vCard downloads receive.
              </p>
            </div>
            <Link to="/features" className="text-sm font-semibold text-[#1D4ED8] hover:underline whitespace-nowrap">
              Explore all capabilities →
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 bg-[#071226] text-white rounded-2xl p-8 flex flex-col justify-between border border-slate-800">
              <div>
                <div className="inline-flex items-center gap-2 text-cyan-400 text-xs font-semibold mb-4">
                  <Smartphone className="h-4 w-4" />
                  <span>One-Tap SMART &amp; Universal QR Fallback</span>
                </div>
                <h3 className="font-display text-2xl font-bold tracking-tight">
                  Update your digital details without reprinting the card.
                </h3>
                <p className="mt-3 text-slate-300 text-sm sm:text-base leading-relaxed max-w-xl">
                  Both the encoded SMART chip and the printed QR code resolve to your permanent profile URL. Change your phone number, title, WhatsApp, or custom links anytime—your physical card keeps working forever.
                </p>
              </div>
              <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 gap-4 pt-6 border-t border-slate-800 text-xs text-slate-300">
                <div className="flex items-center gap-2"><Download className="h-4 w-4 text-cyan-400 shrink-0" /><span>One-Tap Save Contact (.vcf)</span></div>
                <div className="flex items-center gap-2"><Share2 className="h-4 w-4 text-cyan-400 shrink-0" /><span>16+ Social Platforms</span></div>
                <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-cyan-400 shrink-0" /><span>Field-Level Privacy</span></div>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 flex flex-col justify-between">
              <div>
                <QrCode className="h-6 w-6 text-[#1D4ED8] mb-3" />
                <h3 className="font-display text-lg font-bold text-[#0B1D3A]">
                  Custom Business Card Design
                </h3>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                  Customize background colors, upload logos, adjust typography, and preview both front and back in exact 85.6 × 54 mm proportions.
                </p>
              </div>
              <Link
                to="/dashboard/card-design"
                className="mt-6 inline-flex items-center text-sm font-semibold text-[#1D4ED8] hover:underline"
              >
                Open Design Studio →
              </Link>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6">
              <CreditCard className="h-6 w-6 text-[#1D4ED8] mb-3" />
              <h3 className="font-display text-lg font-bold text-[#0B1D3A]">
                Zero Paper Waste
              </h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                Replace hundreds of disposable paper cards with a single durable smart card built for daily networking.
              </p>
            </div>

            <div className="md:col-span-2 bg-slate-50 border border-slate-200 rounded-2xl p-6 grid grid-cols-1 sm:grid-cols-2 gap-6 items-center">
              <div>
                <RefreshCw className="h-6 w-6 text-[#1D4ED8] mb-3" />
                <h3 className="font-display text-lg font-bold text-[#0B1D3A]">
                  Granular Public Visibility & Custom Fields
                </h3>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                  Keep alternate phone numbers or internal emails private while exposing GST numbers, booking links, or office numbers selectively.
                </p>
              </div>
              <div className="group rounded-xl overflow-hidden border border-slate-200 aspect-[4/3] bg-slate-100 shadow-xs hover:shadow-lg hover:border-blue-300/80 transition-all duration-500">
                <img
                  src={WORKFLOW_IMG}
                  alt="Professionals exchanging digital business profile with SMART card"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Interactive Card Design Showcase */}
      <section id="card-designs" className="py-16 lg:py-20 bg-slate-50 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-5">
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#0B1D3A] tracking-tight">
                Predefined Card Templates & Custom Studio
              </h2>
              <p className="mt-3 text-slate-600 text-sm sm:text-base leading-relaxed">
                Select a signature finish below to preview the front layout. Before purchase, the QR slot displays a secure non-scannable placeholder until your order is verified.
              </p>

              <div className="mt-6 grid grid-cols-2 gap-2.5">
                {templates.slice(0, 8).map((tpl) => {
                  const active = selectedTpl.templateId === tpl.templateId;
                  return (
                    <button
                      key={tpl.templateId}
                      type="button"
                      onClick={() => setSelectedTpl(tpl)}
                      className={`text-left px-3.5 py-2.5 rounded-lg border text-xs font-medium transition-colors ${
                        active
                          ? 'bg-[#0B1D3A] text-white border-[#0B1D3A]'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="truncate font-semibold">{tpl.name}</div>
                      <div className={`font-mono text-[11px] mt-0.5 ${active ? 'text-cyan-300' : 'text-slate-500'}`}>
                        ₹{tpl.priceInr}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-6">
                <Link
                  to="/dashboard/card-design"
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#1D4ED8] hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
                >
                  <span>Customize {selectedTpl.name}</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>

            <div className="lg:col-span-7 space-y-6">
              <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8">
                <div className="flex items-center justify-between text-xs text-slate-500 mb-4">
                  <span>{selectedTpl.name} · {(selectedTpl.cardType || 'SMART Card').replace(/NFC/g, 'SMART')}</span>
                  <span className="font-mono tabular-nums">85.6 × 54.0 mm</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-center">
                  <div className="transition-transform duration-300 ease-out hover:-translate-y-1">
                    <div className="text-xs font-medium text-slate-500 mb-2">Front Side</div>
                    <CardCanvasPreview
                      side={selectedTpl.frontSpec}
                      orientation="landscape"
                      personalInfo={SAMPLE_PERSON}
                    />
                  </div>
                  <div className="transition-transform duration-300 ease-out hover:-translate-y-1">
                    <div className="text-xs font-medium text-slate-500 mb-2">Back Side (QR Placeholder)</div>
                    <CardCanvasPreview
                      side={selectedTpl.backSpec}
                      orientation="landscape"
                      personalInfo={SAMPLE_PERSON}
                    />
                  </div>
                </div>
              </div>

              <div className="group rounded-2xl overflow-hidden border border-slate-200 aspect-[16/7] bg-slate-100 shadow-xs hover:shadow-xl hover:border-blue-300/80 transition-all duration-500">
                <img
                  src={SHOWCASE_IMG}
                  alt="Luxury matte navy, obsidian black, and pearl white SMART business cards"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4B. Smart Safety Tags & Accessories Shop Showcase */}
      <section className="py-16 lg:py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-10">
            <div>
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#0B1D3A] tracking-tight">
                Smart Safety Tags &amp; Recovery Stickers
              </h2>
              <p className="mt-2 text-slate-600 max-w-2xl text-sm sm:text-base">
                Protect helmets, kids school bags, pets, and personal gear with scannable SMART tags linked to your digital profile.
              </p>
            </div>
            <Link
              to="/shop"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1D4ED8] hover:underline whitespace-nowrap"
            >
              <span>Browse All Smart Tags</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {featuredShopProducts.map((item) => {
              const catName =
                shopCategories.find((c) => c.categoryId === item.categoryId)?.name ||
                item.categoryName ||
                'Smart Tag';
              return (
                <Link
                  key={item.productId}
                  to={`/shop?category=${encodeURIComponent(item.categoryId)}`}
                  className="group bg-slate-50 border border-slate-200 rounded-2xl overflow-hidden flex flex-col justify-between hover:shadow-md hover:border-blue-300 transition-all"
                >
                  <div>
                    <div className="aspect-[4/3] bg-slate-100 overflow-hidden">
                      <img
                        src={item.imageDataUrl}
                        alt={item.name}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    </div>
                    <div className="p-4">
                      <div className="text-[11px] font-semibold text-[#1D4ED8] truncate">
                        {catName}
                      </div>
                      <h3 className="mt-1 font-display text-base font-bold text-[#0B1D3A] leading-snug line-clamp-2">
                        {item.name}
                      </h3>
                    </div>
                  </div>
                  <div className="px-4 pb-4 flex items-center justify-between">
                    <span className="font-display text-lg font-extrabold text-[#0B1D3A] tabular-nums">
                      ₹{item.priceInr}
                    </span>
                    <span className="text-xs font-semibold text-[#1D4ED8] group-hover:underline">
                      View Tag →
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* 5. Benefits by Profession */}
      <section className="py-16 lg:py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mb-10">
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#0B1D3A] tracking-tight">
              Built for Modern Teams and Independent Professionals
            </h2>
            <p className="mt-2 text-slate-600">
              Adaptable digital profiles and durable smart cards tailored to how you meet clients.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {AUDIENCE_BENEFITS.map((item) => (
              <div key={item.role} className="border border-slate-200 rounded-xl p-5 bg-slate-50/60">
                <h3 className="font-display text-base font-bold text-[#0B1D3A]">{item.role}</h3>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">{item.benefit}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 6. Pricing Preview */}
      <section className="py-16 lg:py-20 bg-[#071226] text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch">
            <div className="lg:col-span-1 flex flex-col justify-center">
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">
                Transparent Card Pricing in INR
              </h2>
              <p className="mt-3 text-slate-300 text-sm leading-relaxed">
                No recurring subscription required for your digital profile. Pay once per personalized SMART business card, printed at 300 DPI and delivered across India in 10–15 days.
              </p>
              <Link
                to="/pricing"
                className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-cyan-400 hover:text-cyan-300"
              >
                <span>Compare card finishes & bulk rates</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-7 flex flex-col justify-between">
              <div>
                <div className="text-sm font-semibold text-cyan-400">PVC Matte / Gloss SMART</div>
                <div className="mt-2 font-display text-3xl font-bold tabular-nums">₹1,200 – ₹1,500</div>
                <p className="mt-2 text-xs text-slate-400">Ideal for founders, consultants, and sales teams</p>
                <ul className="mt-5 space-y-2.5 text-sm text-slate-300">
                  <li className="flex items-center gap-2"><Check className="h-4 w-4 text-cyan-400" /><span>85.6 × 54 mm ISO ID-1 precision trim</span></li>
                  <li className="flex items-center gap-2"><Check className="h-4 w-4 text-cyan-400" /><span>NTAG215 SMART chip + fallback QR</span></li>
                  <li className="flex items-center gap-2"><Check className="h-4 w-4 text-cyan-400" /><span>Live digital profile & vCard download</span></li>
                </ul>
              </div>
              <Link
                to="/register"
                className="mt-7 block text-center py-3 rounded-xl bg-white text-[#0B1D3A] text-sm font-semibold hover:bg-slate-100 transition-colors"
              >
                Start Designing
              </Link>
            </div>

            <div className="bg-slate-900/90 border border-blue-500/40 rounded-2xl p-7 flex flex-col justify-between">
              <div>
                <div className="text-sm font-semibold text-cyan-400">Metal Hybrid Executive SMART</div>
                <div className="mt-2 font-display text-3xl font-bold tabular-nums">₹2,000 – ₹2,500</div>
                <p className="mt-2 text-xs text-slate-400">Brushed dark metal finish for executive presence</p>
                <ul className="mt-5 space-y-2.5 text-sm text-slate-300">
                  <li className="flex items-center gap-2"><Check className="h-4 w-4 text-cyan-400" /><span>Custom front/back artwork at 300 DPI</span></li>
                  <li className="flex items-center gap-2"><Check className="h-4 w-4 text-cyan-400" /><span>Multiple digital profiles support</span></li>
                  <li className="flex items-center gap-2"><Check className="h-4 w-4 text-cyan-400" /><span>Tracked pan-India courier shipping</span></li>
                </ul>
              </div>
              <Link
                to="/register"
                className="mt-7 block text-center py-3 rounded-xl bg-[#1D4ED8] text-white text-sm font-semibold hover:bg-blue-600 transition-colors"
              >
                Order Executive Card
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 7. FAQ Section */}
      <section className="py-16 lg:py-20 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#0B1D3A] tracking-tight text-center">
            Frequently Asked Questions
          </h2>
          <div className="mt-8 divide-y divide-slate-200 border border-slate-200 rounded-2xl bg-slate-50/40">
            {FAQS.map((item, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div key={item.q} className="p-5">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    className="w-full flex items-center justify-between gap-4 text-left font-display font-semibold text-[#0B1D3A]"
                  >
                    <span>{item.q}</span>
                    <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {isOpen && <p className="mt-3 text-sm text-slate-600 leading-relaxed">{item.a}</p>}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </PublicLayout>
  );
};
