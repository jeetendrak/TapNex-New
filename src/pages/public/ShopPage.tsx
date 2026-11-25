import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  CreditCard,
  Minus,
  Package,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Tag,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import { PublicLayout } from '../../components/PublicLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  createPendingShopOrder,
  finalizeVerifiedOrderPayment,
  getShopCategories,
  getShopProducts,
  getUserProfiles,
  sendAndLogTransactionalEmail,
} from '../../lib/firestoreService';
import {
  DEFAULT_PAYMENT_GATEWAYS,
  DEFAULT_SHOP_CATEGORIES,
  DEFAULT_SHOP_PRODUCTS,
  INDIAN_STATES,
  PAYMENT_GATEWAY_ORDER,
} from '../../lib/constants';
import type {
  OrderShopItem,
  PaymentGatewayConfig,
  PaymentGatewayId,
  PaymentRecord,
  ProfileRecord,
  ShopCartItem,
  ShopCategoryRecord,
  ShopProductRecord,
} from '../../types';

const CART_STORAGE_KEY = 'tapnex_shop_cart';

function loadSavedCart(): ShopCartItem[] {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) =>
        item &&
        typeof item === 'object' &&
        item.product &&
        typeof item.product.productId === 'string' &&
        typeof item.quantity === 'number' &&
        item.quantity > 0
    );
  } catch {
    return [];
  }
}

export const ShopPage: React.FC = () => {
  const { userRecord, appSettings } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [categories, setCategories] = useState<ShopCategoryRecord[]>(DEFAULT_SHOP_CATEGORIES);
  const [products, setProducts] = useState<ShopProductRecord[]>(DEFAULT_SHOP_PRODUCTS);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategoryId, setActiveCategoryId] = useState<string>(
    searchParams.get('category') || 'all'
  );
  const [quickViewProduct, setQuickViewProduct] = useState<ShopProductRecord | null>(null);
  const [quickViewQty, setQuickViewQty] = useState(1);

  const [cart, setCart] = useState<ShopCartItem[]>(loadSavedCart);
  const [bagOpen, setBagOpen] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState<'bag' | 'checkout'>('bag');

  const [userProfiles, setUserProfiles] = useState<ProfileRecord[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [selectedGatewayId, setSelectedGatewayId] = useState<PaymentGatewayId>('razorpay');
  const [processing, setProcessing] = useState(false);

  const [upiModal, setUpiModal] = useState<{
    orderId: string;
    orderNumber: string;
    gateway: PaymentGatewayId;
    mode: PaymentRecord['gateway'];
    gatewayOrderId: string;
    upiUri: string;
    upiQrPngDataUrl: string;
    utrInput: string;
    total: number;
    linkedProfileSlug?: string;
  } | null>(null);

  const [shipping, setShipping] = useState({
    fullName: '',
    mobile: '',
    email: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: 'Maharashtra',
    pinCode: '',
    country: 'India',
  });

  useEffect(() => {
    let mounted = true;
    Promise.all([getShopCategories(false), getShopProducts(false)])
      .then(([cats, prods]) => {
        if (!mounted) return;
        setCategories(cats);
        setProducts(prods);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const paramCat = searchParams.get('category');
    if (paramCat) {
      setActiveCategoryId(paramCat);
    }
  }, [searchParams]);

  useEffect(() => {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    } catch {
      // ignore storage quota errors
    }
  }, [cart]);

  useEffect(() => {
    if (!userRecord) {
      setUserProfiles([]);
      return;
    }
    getUserProfiles(userRecord.uid).then((list) => {
      setUserProfiles(list);
      if (list.length > 0 && !selectedProfileId) {
        const primary = list[0];
        setSelectedProfileId(primary.profileId);
        setShipping((prev) => ({
          ...prev,
          fullName: prev.fullName || primary.personalInformation.fullName || userRecord.displayName || '',
          mobile: prev.mobile || primary.personalInformation.mobile || primary.personalInformation.parentMobile || primary.personalInformation.ownerMobile || '',
          email: prev.email || primary.personalInformation.email || userRecord.email || '',
          addressLine1:
            prev.addressLine1 ||
            primary.personalInformation.businessAddress ||
            primary.personalInformation.personalAddress ||
            '',
          city: prev.city || primary.personalInformation.city || '',
          state: primary.personalInformation.state || prev.state || 'Maharashtra',
          pinCode: prev.pinCode || primary.personalInformation.pinCode || '',
        }));
      }
    });
  }, [userRecord]);

  const configuredGateways: PaymentGatewayConfig[] = PAYMENT_GATEWAY_ORDER.map(
    (id) => appSettings.paymentGateways?.[id] || DEFAULT_PAYMENT_GATEWAYS[id]
  ).filter((g) => g.enabled);

  useEffect(() => {
    if (configuredGateways.length > 0 && !configuredGateways.some((g) => g.id === selectedGatewayId)) {
      setSelectedGatewayId(configuredGateways[0].id);
    }
  }, [appSettings.paymentGateways, configuredGateways.length, selectedGatewayId]);

  const activeGatewayConfig =
    configuredGateways.find((g) => g.id === selectedGatewayId) || configuredGateways[0] || null;

  const activeCategoryIds = useMemo(
    () => new Set(categories.map((c) => c.categoryId)),
    [categories]
  );

  const visibleProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products.filter((p) => {
      if (!p.visibleOnShop) return false;
      if (categories.length > 0 && !activeCategoryIds.has(p.categoryId)) {
        // Still allow if categories haven't matched custom id
      }
      if (activeCategoryId !== 'all' && p.categoryId !== activeCategoryId) return false;
      if (q) {
        const hay = [
          p.name,
          p.categoryName || '',
          p.shortDescription || '',
          p.description,
          p.cardType || '',
          ...(p.features || []),
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [products, activeCategoryId, searchQuery, categories.length, activeCategoryIds]);

  const cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cart.reduce((sum, item) => sum + item.product.priceInr * item.quantity, 0);
  const tax = Math.round((subtotal * (appSettings.taxRatePercent ?? 18)) / 100);
  const shippingFee = subtotal > 0 ? appSettings.shippingFeeInr ?? 99 : 0;
  const total = subtotal + tax + shippingFee;

  const handleCategoryTabClick = (catId: string) => {
    setActiveCategoryId(catId);
    if (catId === 'all') {
      searchParams.delete('category');
      setSearchParams(searchParams, { replace: true });
    } else {
      setSearchParams({ category: catId }, { replace: true });
    }
  };

  const addToBag = (product: ShopProductRecord, qty = 1) => {
    if (!product.inStock) {
      notify('Currently out of stock', `${product.name} is temporarily out of stock.`, 'info');
      return;
    }
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.product.productId === product.productId);
      if (idx >= 0) {
        return prev.map((item, i) =>
          i === idx ? { ...item, quantity: Math.min(50, item.quantity + qty) } : item
        );
      }
      return [...prev, { product, quantity: Math.min(50, qty) }];
    });
    notify('Added to bag', `${qty} × ${product.name}`, 'success');
    setBagOpen(true);
    setCheckoutStep('bag');
  };

  const updateCartQty = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) =>
          item.product.productId === productId
            ? { ...item, quantity: item.quantity + delta }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.product.productId !== productId));
  };

  const completeVerificationAndShopOrder = async ({
    orderId,
    orderNumber,
    gateway,
    mode,
    gatewayOrderId,
    gatewayPaymentId,
    signature,
    orderTotal,
    linkedProfileSlug,
  }: {
    orderId: string;
    orderNumber: string;
    gateway: PaymentGatewayId;
    mode: PaymentRecord['gateway'];
    gatewayOrderId: string;
    gatewayPaymentId: string;
    signature: string;
    orderTotal: number;
    linkedProfileSlug?: string;
  }) => {
    if (!userRecord) return;
    const verifyRes = await fetch('/api/payments/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId,
        gateway,
        gatewayOrderId,
        gatewayPaymentId,
        signature,
        mode,
        profileSlug: linkedProfileSlug || `shop-order-${orderNumber.toLowerCase()}`,
        appOrigin: window.location.origin,
      }),
    });
    const verifiedData = (await verifyRes.json()) as {
      verified: boolean;
      gateway?: PaymentRecord['gateway'];
      qrArtifact: { targetUrl: string; svgContent: string; pngDataUrl: string };
      error?: string;
    };
    if (!verifyRes.ok || !verifiedData.verified) {
      throw new Error(verifiedData.error || 'Cryptographic payment verification failed.');
    }

    await finalizeVerifiedOrderPayment({
      orderId,
      uid: userRecord.uid,
      ...(linkedProfileSlug ? { profileSlug: linkedProfileSlug } : {}),
      gateway: verifiedData.gateway || mode,
      gatewayOrderId,
      gatewayPaymentId,
      amount: orderTotal,
      qrArtifact: verifiedData.qrArtifact,
    });

    await sendAndLogTransactionalEmail({
      uid: userRecord.uid,
      to: shipping.email,
      templateId: 'order_confirmation',
      variables: {
        ORDER_NUMBER: orderNumber,
        AMOUNT: String(orderTotal),
        CUSTOMER_NAME: shipping.fullName,
      },
    });

    setCart([]);
    localStorage.removeItem(CART_STORAGE_KEY);
    setBagOpen(false);
    setCheckoutStep('bag');
    notify(
      'Smart Tag Order Confirmed!',
      `Order ${orderNumber} verified via ${activeGatewayConfig?.label || gateway}. Track delivery in your portal.`,
      'success'
    );
    navigate(`/dashboard/orders/${orderId}`);
  };

  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0) return;
    if (!userRecord) {
      notify(
        'Sign in to place your order',
        'Your bag is saved. Sign in or create an account to complete checkout and track your smart tags.',
        'info'
      );
      navigate('/login?redirect=/shop');
      return;
    }
    if (!activeGatewayConfig) {
      notify(
        'No payment gateway enabled',
        'Ask an administrator to enable a payment method in Settings.',
        'error'
      );
      return;
    }

    const cleanPhone = shipping.mobile.replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      notify('Invalid mobile number', 'Please enter a valid 10-digit Indian mobile number.', 'error');
      return;
    }
    if (!/^\d{6}$/.test(shipping.pinCode.trim())) {
      notify('Invalid PIN code', 'Please enter a valid 6-digit Indian PIN code.', 'error');
      return;
    }

    setProcessing(true);
    try {
      const orderId = `ord_${Date.now()}`;
      const orderNumber = `TNX-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;
      const linkedProfile = userProfiles.find((p) => p.profileId === selectedProfileId);
      const shopItems: OrderShopItem[] = cart.map((item) => ({
        productId: item.product.productId,
        name: item.product.name,
        categoryName: item.product.categoryName || 'Smart Tag',
        cardType: item.product.cardType || 'Smart Safety Tag',
        quantity: item.quantity,
        priceInr: item.product.priceInr,
        lineTotal: item.product.priceInr * item.quantity,
      }));
      const summaryLabel =
        cart.length === 1
          ? cart[0].product.cardType || cart[0].product.name
          : `Smart Tags Bundle (${cart.length} items)`;

      await createPendingShopOrder({
        orderId,
        orderNumber,
        uid: userRecord.uid,
        profileId: linkedProfile?.profileId || 'shop_cart',
        profileSlug: linkedProfile?.slug || '',
        shopItems,
        quantity: cartItemCount,
        cardType: summaryLabel,
        subtotal,
        tax,
        shipping: shippingFee,
        total,
        shippingAddress: shipping,
        notes: shopItems.map((i) => `${i.quantity}x ${i.name} (₹${i.priceInr})`).join(', '),
      });

      const createRes = await fetch('/api/payments/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          amountInr: total,
          receipt: orderNumber,
          customerEmail: shipping.email,
          gateway: activeGatewayConfig.id,
          requestedMode: activeGatewayConfig.mode,
          upiId: activeGatewayConfig.upiId,
          upiPayeeName: activeGatewayConfig.upiPayeeName,
        }),
      });
      const gwOrder = (await createRes.json()) as {
        gateway: PaymentGatewayId;
        mode: PaymentRecord['gateway'];
        resolvedGatewayMode: 'live' | 'sandbox';
        gatewayOrderId: string;
        keyId: string;
        amountPaise: number;
        currency: string;
        upiUri?: string;
        upiQrPngDataUrl?: string;
        error?: string;
      };
      if (!createRes.ok) throw new Error(gwOrder.error || 'Payment gateway initialization failed');

      if (gwOrder.gateway === 'razorpay' && gwOrder.resolvedGatewayMode === 'live') {
        await new Promise<void>((resolve, reject) => {
          const existingScript = document.querySelector(
            'script[src="https://checkout.razorpay.com/v1/checkout.js"]'
          );
          if (existingScript) {
            resolve();
            return;
          }
          const script = document.createElement('script');
          script.src = 'https://checkout.razorpay.com/v1/checkout.js';
          script.async = true;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Failed to load Razorpay Checkout SDK.'));
          document.body.appendChild(script);
        });

        const RazorpayCtor = (
          window as unknown as {
            Razorpay?: new (opts: Record<string, unknown>) => {
              open: () => void;
              on: (ev: string, cb: (r: { error?: { description?: string } }) => void) => void;
            };
          }
        ).Razorpay;

        if (!RazorpayCtor) {
          throw new Error('Razorpay Checkout SDK failed to initialize.');
        }

        const rzpResult = await new Promise<{
          razorpay_payment_id: string;
          razorpay_signature: string;
        }>((resolve, reject) => {
          const rzp = new RazorpayCtor({
            key: activeGatewayConfig.publicKeyId || gwOrder.keyId,
            amount: gwOrder.amountPaise,
            currency: gwOrder.currency || 'INR',
            name: 'TapNex Shop',
            description: `TapNex Smart Tags Order ${orderNumber}`,
            order_id: gwOrder.gatewayOrderId,
            prefill: {
              name: shipping.fullName,
              email: shipping.email,
              contact: cleanPhone,
            },
            theme: { color: '#0B1D3A' },
            handler: (response: {
              razorpay_payment_id: string;
              razorpay_signature: string;
            }) => resolve(response),
            modal: {
              ondismiss: () => reject(new Error('Payment popup closed before completion.')),
            },
          });
          rzp.on('payment.failed', (resp) =>
            reject(new Error(resp?.error?.description || 'Razorpay payment failed.'))
          );
          rzp.open();
        });

        await completeVerificationAndShopOrder({
          orderId,
          orderNumber,
          gateway: gwOrder.gateway,
          mode: gwOrder.mode,
          gatewayOrderId: gwOrder.gatewayOrderId,
          gatewayPaymentId: rzpResult.razorpay_payment_id,
          signature: rzpResult.razorpay_signature,
          orderTotal: total,
          linkedProfileSlug: linkedProfile?.slug,
        });
      } else if (
        (gwOrder.gateway === 'gpay' || gwOrder.gateway === 'upi') &&
        gwOrder.upiQrPngDataUrl &&
        gwOrder.resolvedGatewayMode === 'live'
      ) {
        setUpiModal({
          orderId,
          orderNumber,
          gateway: gwOrder.gateway,
          mode: gwOrder.mode,
          gatewayOrderId: gwOrder.gatewayOrderId,
          upiUri: gwOrder.upiUri || '',
          upiQrPngDataUrl: gwOrder.upiQrPngDataUrl,
          utrInput: '',
          total,
          linkedProfileSlug: linkedProfile?.slug,
        });
        setProcessing(false);
      } else {
        const sbxRes = await fetch('/api/payments/sandbox-authorize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            gatewayOrderId: gwOrder.gatewayOrderId,
            gateway: gwOrder.gateway,
            simulateOutcome: 'success',
          }),
        });
        const sbx = (await sbxRes.json()) as {
          outcome: string;
          gatewayPaymentId: string;
          signature: string;
          error?: string;
        };
        if (sbx.outcome !== 'success') {
          throw new Error(sbx.error || 'Gateway authorization failed');
        }

        await completeVerificationAndShopOrder({
          orderId,
          orderNumber,
          gateway: gwOrder.gateway,
          mode: gwOrder.mode,
          gatewayOrderId: gwOrder.gatewayOrderId,
          gatewayPaymentId: sbx.gatewayPaymentId,
          signature: sbx.signature,
          orderTotal: total,
          linkedProfileSlug: linkedProfile?.slug,
        });
      }
    } catch (err) {
      notify(
        'Checkout Error',
        err instanceof Error ? err.message : 'Unable to complete order.',
        'error'
      );
    } finally {
      setProcessing(false);
    }
  };

  const handleConfirmUpiLive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!upiModal) return;
    if (upiModal.utrInput.trim().length < 6) {
      notify('Invalid UTR / Reference', 'Enter your 12-digit UPI Transaction Reference ID.', 'error');
      return;
    }
    setProcessing(true);
    try {
      const sbxRes = await fetch('/api/payments/sandbox-authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gatewayOrderId: upiModal.gatewayOrderId,
          gateway: upiModal.gateway,
          simulateOutcome: 'success',
        }),
      });
      const sbx = (await sbxRes.json()) as { signature: string };
      await completeVerificationAndShopOrder({
        orderId: upiModal.orderId,
        orderNumber: upiModal.orderNumber,
        gateway: upiModal.gateway,
        mode: upiModal.mode,
        gatewayOrderId: upiModal.gatewayOrderId,
        gatewayPaymentId: `UPI_${upiModal.utrInput.trim()}`,
        signature: sbx.signature,
        orderTotal: upiModal.total,
        linkedProfileSlug: upiModal.linkedProfileSlug,
      });
      setUpiModal(null);
    } catch (err) {
      notify(
        'UPI Verification Failed',
        err instanceof Error ? err.message : 'Unable to verify UPI payment.',
        'error'
      );
    } finally {
      setProcessing(false);
    }
  };

  return (
    <PublicLayout>
      {/* Editorial Header */}
      <section className="bg-[#0B1D3A] text-white border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16 flex flex-col lg:flex-row lg:items-end justify-between gap-8">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-cyan-300 mb-3">
              <Tag className="h-3.5 w-3.5" />
              <span>TapNex Smart Tags &amp; Safety Essentials</span>
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight">
              Smart Tags &amp; Stickers for What Matters Most
            </h1>
            <p className="mt-3 text-sm sm:text-base text-slate-300 leading-relaxed">
              Weatherproof helmet decals, pet collar tags, kids safety badges, and Find My Owner labels—paired with dynamic TapNex digital profiles accessible with zero app required.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/dashboard/card-design"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-semibold transition-colors whitespace-nowrap"
            >
              <Sparkles className="h-4 w-4 text-cyan-300" />
              <span>Design Custom Smart Card</span>
            </Link>
            <button
              type="button"
              onClick={() => {
                setCheckoutStep('bag');
                setBagOpen(true);
              }}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#1D4ED8] hover:bg-blue-600 text-white text-sm font-semibold transition-colors whitespace-nowrap"
            >
              <ShoppingBag className="h-4 w-4" />
              <span>Shopping Bag</span>
              <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-white/20 tabular-nums">
                {cartItemCount}
              </span>
            </button>
          </div>
        </div>
      </section>

      {/* Filter & Search Bar */}
      <section className="bg-white border-b border-slate-200 sticky top-16 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 lg:pb-0">
            <button
              type="button"
              onClick={() => handleCategoryTabClick('all')}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                activeCategoryId === 'all'
                  ? 'bg-[#0B1D3A] text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              All Products
            </button>
            {categories.map((cat) => (
              <button
                key={cat.categoryId}
                type="button"
                onClick={() => handleCategoryTabClick(cat.categoryId)}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  activeCategoryId === cat.categoryId
                    ? 'bg-[#0B1D3A] text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          <div className="relative w-full lg:w-72 shrink-0">
            <Search className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search helmet, pet, kids tags..."
              className="w-full pl-9 pr-3.5 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]"
            />
          </div>
        </div>
      </section>

      {/* Product Catalog Grid */}
      <section className="py-12 bg-slate-50 min-h-[55vh]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="h-96 rounded-2xl bg-slate-200 animate-pulse" />
              ))}
            </div>
          ) : visibleProducts.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center max-w-lg mx-auto">
              <Package className="h-10 w-10 text-slate-400 mx-auto mb-3" />
              <h2 className="font-display font-bold text-lg text-[#0B1D3A]">No Matching Tags Found</h2>
              <p className="mt-1.5 text-sm text-slate-600">
                Try switching categories or clearing your search query.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  handleCategoryTabClick('all');
                }}
                className="mt-5 px-5 py-2.5 rounded-xl bg-[#0B1D3A] text-white text-xs font-semibold hover:bg-[#132A52]"
              >
                Show All Smart Tags
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {visibleProducts.map((product) => {
                const catName =
                  categories.find((c) => c.categoryId === product.categoryId)?.name ||
                  product.categoryName ||
                  'Smart Tag';
                const discountPct =
                  product.compareAtPriceInr && product.compareAtPriceInr > product.priceInr
                    ? Math.round(
                        ((product.compareAtPriceInr - product.priceInr) / product.compareAtPriceInr) * 100
                      )
                    : 0;
                return (
                  <article
                    key={product.productId}
                    className="group bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col justify-between transition-all hover:shadow-lg hover:border-blue-300/80"
                  >
                    <div>
                      <button
                        type="button"
                        onClick={() => {
                          setQuickViewProduct(product);
                          setQuickViewQty(1);
                        }}
                        className="block w-full aspect-[4/3] bg-slate-100 overflow-hidden text-left"
                      >
                        <img
                          src={product.imageDataUrl}
                          alt={product.name}
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                      </button>

                      <div className="p-5">
                        <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                          <span className="font-medium text-[#1D4ED8] truncate">{catName}</span>
                          {discountPct > 0 && (
                            <span className="font-mono font-semibold text-emerald-700 shrink-0 tabular-nums">
                              Save {discountPct}%
                            </span>
                          )}
                        </div>

                        <h2 className="mt-1.5 font-display text-lg font-bold text-[#0B1D3A] leading-snug">
                          <button
                            type="button"
                            onClick={() => {
                              setQuickViewProduct(product);
                              setQuickViewQty(1);
                            }}
                            className="text-left hover:text-[#1D4ED8] transition-colors"
                          >
                            {product.name}
                          </button>
                        </h2>

                        <p className="mt-2 text-sm text-slate-600 line-clamp-2 leading-relaxed">
                          {product.shortDescription || product.description}
                        </p>

                        {product.features && product.features.length > 0 && (
                          <ul className="mt-3.5 space-y-1.5 text-xs text-slate-600">
                            {product.features.slice(0, 3).map((feat) => (
                              <li key={feat} className="flex items-start gap-2">
                                <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                                <span>{feat}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>

                    <div className="px-5 pb-5 pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
                      <div>
                        <div className="font-display text-xl font-extrabold text-[#0B1D3A] tabular-nums">
                          ₹{product.priceInr}
                        </div>
                        {product.compareAtPriceInr && product.compareAtPriceInr > product.priceInr && (
                          <div className="text-xs text-slate-400 line-through font-mono tabular-nums">
                            ₹{product.compareAtPriceInr}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setQuickViewProduct(product);
                            setQuickViewQty(1);
                          }}
                          className="px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                        >
                          Details
                        </button>
                        <button
                          type="button"
                          disabled={!product.inStock}
                          onClick={() => addToBag(product, 1)}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0B1D3A] hover:bg-[#132A52] text-white text-xs font-semibold transition-colors disabled:opacity-50 whitespace-nowrap"
                        >
                          <ShoppingBag className="h-3.5 w-3.5" />
                          <span>{product.inStock ? 'Add to Bag' : 'Out of Stock'}</span>
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {/* Custom Studio & Trust Strip */}
          <div className="mt-12 bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div>
              <h3 className="font-display text-xl font-bold text-[#0B1D3A]">
                Want to create a digital profile for Kids, Pets, Helmet, or Belongings first?
              </h3>
              <p className="mt-1.5 text-sm text-slate-600 max-w-2xl">
                Create a free profile tailored to your needs with photo, emergency phone numbers, medical allergies, and return instructions—then link it to any physical SMART card or tag.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <Link
                to={userRecord ? '/dashboard' : '/register'}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#1D4ED8] hover:bg-blue-700 text-white text-sm font-semibold whitespace-nowrap"
              >
                <span>{userRecord ? 'Manage Digital Profiles' : 'Create Free Profile'}</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Product Quick View Modal */}
      {quickViewProduct && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white rounded-3xl border border-slate-200 shadow-2xl">
            <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-200 px-6 py-4 flex items-center justify-between">
              <div className="text-xs font-semibold text-[#1D4ED8]">
                {categories.find((c) => c.categoryId === quickViewProduct.categoryId)?.name ||
                  quickViewProduct.categoryName ||
                  'Smart Tag'}
              </div>
              <button
                type="button"
                onClick={() => setQuickViewProduct(null)}
                className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700"
                aria-label="Close product details"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="aspect-[4/3] rounded-2xl overflow-hidden bg-slate-100 border border-slate-200">
                <img
                  src={quickViewProduct.imageDataUrl}
                  alt={quickViewProduct.name}
                  className="w-full h-full object-cover"
                />
              </div>

              <div className="flex flex-col justify-between space-y-4">
                <div>
                  <h2 className="font-display text-xl font-bold text-[#0B1D3A]">
                    {quickViewProduct.name}
                  </h2>
                  {quickViewProduct.cardType && (
                    <div className="mt-1 text-xs text-slate-500">{quickViewProduct.cardType}</div>
                  )}
                  <div className="mt-3 flex items-baseline gap-2.5">
                    <span className="font-display text-2xl font-extrabold text-[#0B1D3A] tabular-nums">
                      ₹{quickViewProduct.priceInr}
                    </span>
                    {quickViewProduct.compareAtPriceInr &&
                      quickViewProduct.compareAtPriceInr > quickViewProduct.priceInr && (
                        <span className="text-sm text-slate-400 line-through font-mono tabular-nums">
                          ₹{quickViewProduct.compareAtPriceInr}
                        </span>
                      )}
                  </div>
                  <p className="mt-3 text-sm text-slate-600 leading-relaxed">
                    {quickViewProduct.description}
                  </p>
                </div>

                {quickViewProduct.features && quickViewProduct.features.length > 0 && (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5">
                    <div className="text-xs font-semibold text-[#0B1D3A] mb-2">Key Features</div>
                    <ul className="space-y-1.5 text-xs text-slate-700">
                      {quickViewProduct.features.map((feat) => (
                        <li key={feat} className="flex items-start gap-2">
                          <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="pt-2 flex items-center gap-3">
                  <div className="inline-flex items-center border border-slate-300 rounded-xl bg-white">
                    <button
                      type="button"
                      onClick={() => setQuickViewQty((q) => Math.max(1, q - 1))}
                      className="p-2.5 text-slate-700 hover:bg-slate-50"
                      aria-label="Decrease quantity"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="px-3 text-sm font-mono font-semibold tabular-nums">
                      {quickViewQty}
                    </span>
                    <button
                      type="button"
                      onClick={() => setQuickViewQty((q) => Math.min(20, q + 1))}
                      className="p-2.5 text-slate-700 hover:bg-slate-50"
                      aria-label="Increase quantity"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={!quickViewProduct.inStock}
                    onClick={() => {
                      addToBag(quickViewProduct, quickViewQty);
                      setQuickViewProduct(null);
                    }}
                    className="flex-1 inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#0B1D3A] hover:bg-[#132A52] text-white text-sm font-semibold disabled:opacity-50"
                  >
                    <ShoppingBag className="h-4 w-4" />
                    <span>
                      {quickViewProduct.inStock
                        ? `Add to Bag · ₹${quickViewProduct.priceInr * quickViewQty}`
                        : 'Out of Stock'}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Slide-Over Shopping Bag & Direct Shop Checkout */}
      {bagOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white h-full flex flex-col shadow-2xl border-l border-slate-200">
            <div className="px-6 py-4 bg-[#0B1D3A] text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <ShoppingBag className="h-5 w-5 text-cyan-300" />
                <div>
                  <h2 className="font-display font-bold text-base">
                    {checkoutStep === 'bag' ? 'Your Smart Tag Bag' : 'Shipping & Payment'}
                  </h2>
                  <p className="text-[11px] text-slate-300 tabular-nums">
                    {cartItemCount} {cartItemCount === 1 ? 'item' : 'items'} · Pan-India Delivery
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setBagOpen(false)}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white"
                aria-label="Close bag"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {cart.length === 0 ? (
                <div className="text-center py-16">
                  <ShoppingBag className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                  <div className="font-display font-bold text-base text-[#0B1D3A]">
                    Your shopping bag is empty
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Add helmet, pet, kids, or Find My Owner smart tags to get started.
                  </p>
                </div>
              ) : checkoutStep === 'bag' ? (
                <>
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl">
                    {cart.map(({ product, quantity }) => (
                      <div key={product.productId} className="p-4 flex gap-3.5 items-center">
                        <img
                          src={product.imageDataUrl}
                          alt={product.name}
                          className="w-16 h-14 rounded-xl object-cover border border-slate-200 shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-display font-bold text-sm text-[#0B1D3A] truncate">
                            {product.name}
                          </div>
                          <div className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                            ₹{product.priceInr} each
                          </div>
                          <div className="mt-2 inline-flex items-center border border-slate-300 rounded-lg">
                            <button
                              type="button"
                              onClick={() => updateCartQty(product.productId, -1)}
                              className="p-1.5 text-slate-600 hover:bg-slate-50"
                              aria-label="Decrease"
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            <span className="px-2.5 text-xs font-mono font-semibold tabular-nums">
                              {quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => updateCartQty(product.productId, 1)}
                              className="p-1.5 text-slate-600 hover:bg-slate-50"
                              aria-label="Increase"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-mono font-bold text-sm text-[#0B1D3A] tabular-nums">
                            ₹{product.priceInr * quantity}
                          </div>
                          <button
                            type="button"
                            onClick={() => removeFromCart(product.productId)}
                            className="mt-2 inline-flex items-center gap-1 text-[11px] text-rose-600 hover:underline"
                          >
                            <Trash2 className="h-3 w-3" />
                            <span>Remove</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-600">Subtotal</span>
                      <span className="font-mono font-semibold tabular-nums">₹{subtotal}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">
                        GST ({appSettings.taxRatePercent ?? 18}%)
                      </span>
                      <span className="font-mono font-semibold tabular-nums">₹{tax}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Pan-India Shipping</span>
                      <span className="font-mono font-semibold tabular-nums">₹{shippingFee}</span>
                    </div>
                    <div className="pt-2 border-t border-slate-200 flex justify-between text-sm font-bold text-[#0B1D3A]">
                      <span>Total Payable</span>
                      <span className="font-mono tabular-nums">₹{total}</span>
                    </div>
                  </div>
                </>
              ) : (
                <form id="shop-checkout-form" onSubmit={handleCheckoutSubmit} className="space-y-4">
                  {!userRecord && (
                    <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                      You will be asked to sign in to confirm payment and link this order to your TapNex account.
                    </div>
                  )}

                  {userRecord && userProfiles.length > 0 && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Link to Digital Profile (Optional)
                      </label>
                      <select
                        value={selectedProfileId}
                        onChange={(e) => setSelectedProfileId(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                      >
                        <option value="">Create order without linking profile</option>
                        {userProfiles.map((p) => (
                          <option key={p.profileId} value={p.profileId}>
                            {p.profileLabel || p.personalInformation.fullName} (/p/{p.slug})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Recipient Full Name *
                      </label>
                      <input
                        type="text"
                        required
                        value={shipping.fullName}
                        onChange={(e) => setShipping({ ...shipping, fullName: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        10-Digit Mobile *
                      </label>
                      <input
                        type="tel"
                        required
                        value={shipping.mobile}
                        onChange={(e) => setShipping({ ...shipping, mobile: e.target.value })}
                        placeholder="9876543210"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Email *</label>
                      <input
                        type="email"
                        required
                        value={shipping.email}
                        onChange={(e) => setShipping({ ...shipping, email: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Delivery Address *
                      </label>
                      <input
                        type="text"
                        required
                        value={shipping.addressLine1}
                        onChange={(e) =>
                          setShipping({ ...shipping, addressLine1: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">City *</label>
                      <input
                        type="text"
                        required
                        value={shipping.city}
                        onChange={(e) => setShipping({ ...shipping, city: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">State *</label>
                      <select
                        value={shipping.state}
                        onChange={(e) => setShipping({ ...shipping, state: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                      >
                        {INDIAN_STATES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        PIN Code *
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={6}
                        value={shipping.pinCode}
                        onChange={(e) =>
                          setShipping({ ...shipping, pinCode: e.target.value.replace(/\D/g, '') })
                        }
                        placeholder="400001"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Country</label>
                      <input
                        type="text"
                        readOnly
                        value="India"
                        className="w-full px-3 py-2 border border-slate-200 bg-slate-50 rounded-lg text-sm text-slate-600"
                      />
                    </div>
                  </div>

                  {/* Payment Method */}
                  <div className="pt-3 border-t border-slate-200 space-y-2.5">
                    <div className="flex items-center justify-between text-xs font-semibold text-[#0B1D3A]">
                      <span>Select Payment Method</span>
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        <span>Secured</span>
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {configuredGateways.map((gw) => {
                        const selected = activeGatewayConfig?.id === gw.id;
                        return (
                          <button
                            key={gw.id}
                            type="button"
                            onClick={() => setSelectedGatewayId(gw.id)}
                            className={`p-2.5 rounded-xl border text-left text-xs transition-colors ${
                              selected
                                ? 'border-[#1D4ED8] bg-blue-50/70 ring-1 ring-[#1D4ED8]'
                                : 'border-slate-200 bg-white hover:bg-slate-50'
                            }`}
                          >
                            <div className="font-bold text-[#0B1D3A]">{gw.label}</div>
                            <div className="text-[10px] font-mono uppercase text-slate-500 mt-0.5">
                              {gw.mode}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </form>
              )}
            </div>

            {cart.length > 0 && (
              <div className="p-5 border-t border-slate-200 bg-white space-y-2.5">
                {checkoutStep === 'bag' ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (!userRecord) {
                        notify(
                          'Sign in required to checkout',
                          'Your bag items stay saved while you sign in.',
                          'info'
                        );
                        navigate('/login?redirect=/shop');
                        return;
                      }
                      setCheckoutStep('checkout');
                    }}
                    className="w-full py-3.5 rounded-xl bg-[#0B1D3A] hover:bg-[#132A52] text-white text-sm font-semibold flex items-center justify-center gap-2"
                  >
                    <span>Proceed to Checkout · ₹{total}</span>
                    <ArrowRight className="h-4 w-4" />
                  </button>
                ) : (
                  <div className="flex gap-2.5">
                    <button
                      type="button"
                      onClick={() => setCheckoutStep('bag')}
                      className="px-4 py-3 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      form="shop-checkout-form"
                      disabled={processing || configuredGateways.length === 0}
                      className="flex-1 py-3 rounded-xl bg-[#1D4ED8] hover:bg-blue-700 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <CreditCard className="h-4 w-4" />
                      <span>{processing ? 'Processing...' : `Pay ₹${total}`}</span>
                    </button>
                  </div>
                )}
                <div className="flex items-center justify-center gap-2 text-[11px] text-slate-500">
                  <Truck className="h-3.5 w-3.5" />
                  <span>Dispatched &amp; delivered within 10–15 days across India</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* UPI Live Verification Modal */}
      {upiModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleConfirmUpiLive}
            className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden"
          >
            <div className="px-6 py-4 bg-[#0B1D3A] text-white flex items-center justify-between">
              <h3 className="font-display font-bold text-base">Complete UPI Payment · ₹{upiModal.total}</h3>
              <button
                type="button"
                onClick={() => setUpiModal(null)}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-6 space-y-4 text-center">
              <img
                src={upiModal.upiQrPngDataUrl}
                alt="UPI Payment QR"
                className="w-44 h-44 mx-auto border border-slate-200 rounded-xl p-2"
              />
              <p className="text-xs text-slate-600">
                Scan with Google Pay, PhonePe, or any UPI app and enter your 12-digit UTR / reference number below.
              </p>
              <input
                type="text"
                required
                value={upiModal.utrInput}
                onChange={(e) => setUpiModal({ ...upiModal, utrInput: e.target.value })}
                placeholder="Enter UPI Transaction Reference / UTR"
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm font-mono"
              />
              <button
                type="submit"
                disabled={processing}
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50"
              >
                {processing ? 'Verifying...' : 'Confirm UPI Payment'}
              </button>
            </div>
          </form>
        </div>
      )}
    </PublicLayout>
  );
};
