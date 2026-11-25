import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckSquare,
  Eye,
  EyeOff,
  FolderPlus,
  Image as ImageIcon,
  Pencil,
  Plus,
  Search,
  ShoppingBag,
  Tag,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { PortalLayout } from '../../components/PortalLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  deleteShopCategory,
  deleteShopProduct,
  getShopCategories,
  getShopProducts,
  saveShopCategory,
  saveShopProduct,
  seedInitialShopIfEmpty,
} from '../../lib/firestoreService';
import { compressImageFileToDataUrl } from '../../lib/qrArtwork';
import { DEFAULT_SHOP_CATEGORIES } from '../../lib/constants';
import type { ShopCategoryRecord, ShopProductRecord } from '../../types';

function makeEmptyProductDraft(categories: ShopCategoryRecord[], count: number): ShopProductRecord {
  const firstCat = categories[0] || DEFAULT_SHOP_CATEGORIES[0];
  return {
    productId: `prod_${Date.now().toString(36)}`,
    name: '',
    slug: '',
    categoryId: firstCat.categoryId,
    categoryName: firstCat.name,
    shortDescription: '',
    description: '',
    features: ['Weatherproof laser-etched QR', 'Instant scan profile — no app required'],
    priceInr: 499,
    compareAtPriceInr: 699,
    cardType: firstCat.name,
    imageDataUrl: '',
    badgeText: '',
    visibleOnShop: true,
    featured: false,
    inStock: true,
    sortOrder: count + 1,
  };
}

function makeEmptyCategoryDraft(count: number): ShopCategoryRecord {
  return {
    categoryId: `cat_${Date.now().toString(36)}`,
    name: '',
    slug: '',
    description: '',
    sortOrder: count + 1,
    active: true,
  };
}

export const AdminShopPage: React.FC = () => {
  const { userRecord } = useAuth();
  const { notify, confirmAction } = useToast();

  const [tab, setTab] = useState<'products' | 'categories'>('products');
  const [categories, setCategories] = useState<ShopCategoryRecord[]>([]);
  const [products, setProducts] = useState<ShopProductRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Product modal state
  const [productModal, setProductModal] = useState<{
    draft: ShopProductRecord;
    featuresText: string;
    isNew: boolean;
  } | null>(null);
  const [savingProduct, setSavingProduct] = useState(false);

  // Category modal state
  const [categoryModal, setCategoryModal] = useState<{
    draft: ShopCategoryRecord;
    isNew: boolean;
  } | null>(null);
  const [savingCategory, setSavingCategory] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      if (userRecord && (userRecord.role === 'ADMIN' || userRecord.role === 'SUPERADMIN')) {
        await seedInitialShopIfEmpty({
          uid: userRecord.uid,
          email: userRecord.email,
          role: userRecord.role,
        });
      }
      const [cats, prods] = await Promise.all([getShopCategories(true), getShopProducts(true)]);
      setCategories(cats);
      setProducts(prods);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [userRecord?.uid]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      const matchCat = categoryFilter === 'ALL' || p.categoryId === categoryFilter;
      const matchText =
        !q ||
        p.name.toLowerCase().includes(q) ||
        (p.categoryName || '').toLowerCase().includes(q) ||
        (p.shortDescription || '').toLowerCase().includes(q) ||
        (p.cardType || '').toLowerCase().includes(q);
      return matchCat && matchText;
    });
  }, [products, categoryFilter, search]);

  const visibleCount = products.filter((p) => p.visibleOnShop).length;

  const handleToggleProductVisibility = async (prod: ShopProductRecord, nextVisible: boolean) => {
    if (!userRecord) return;
    setBusyId(prod.productId);
    try {
      const updated: ShopProductRecord = { ...prod, visibleOnShop: nextVisible };
      await saveShopProduct(updated, {
        uid: userRecord.uid,
        email: userRecord.email,
        role: userRecord.role,
      });
      setProducts((prev) => prev.map((p) => (p.productId === prod.productId ? updated : p)));
      notify(
        nextVisible ? 'Shown on Shop' : 'Hidden from Shop',
        `${prod.name} is now ${nextVisible ? 'visible' : 'hidden'} to shoppers.`,
        nextVisible ? 'success' : 'info'
      );
    } catch (err) {
      notify('Update failed', err instanceof Error ? err.message : 'Unable to update visibility.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userRecord || !productModal) return;
    const { draft, featuresText, isNew } = productModal;
    if (draft.name.trim().length < 2) {
      notify('Name required', 'Enter a product name of at least 2 characters.', 'error');
      return;
    }
    const matchedCat = categories.find((c) => c.categoryId === draft.categoryId);
    const cleaned: ShopProductRecord = {
      ...draft,
      name: draft.name.trim(),
      categoryName: matchedCat?.name || draft.categoryName || 'Smart Tag',
      features: featuresText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    };
    setSavingProduct(true);
    try {
      await saveShopProduct(cleaned, {
        uid: userRecord.uid,
        email: userRecord.email,
        role: userRecord.role,
      });
      setProductModal(null);
      await loadData();
      notify(isNew ? 'Product added' : 'Product updated', cleaned.name, 'success');
    } catch (err) {
      notify('Save failed', err instanceof Error ? err.message : 'Unable to save product.', 'error');
    } finally {
      setSavingProduct(false);
    }
  };

  const handleDeleteProduct = async (prod: ShopProductRecord) => {
    if (!userRecord) return;
    const ok = await confirmAction({
      title: 'Delete Shop Product',
      message: `Remove "${prod.name}" from the TapNex Shop catalog? Existing placed orders remain intact.`,
      destructive: true,
      confirmLabel: 'Delete Product',
    });
    if (!ok) return;
    setBusyId(prod.productId);
    try {
      await deleteShopProduct(prod.productId, {
        uid: userRecord.uid,
        email: userRecord.email,
        role: userRecord.role,
      });
      await loadData();
      notify('Product deleted', prod.name, 'success');
    } catch (err) {
      notify('Delete failed', err instanceof Error ? err.message : 'Unable to delete product.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleUploadProductImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !productModal) return;
    if (file.size > 6 * 1024 * 1024) {
      notify('Image too large', 'Please upload an image under 6 MB.', 'error');
      return;
    }
    try {
      const compressed = await compressImageFileToDataUrl(file, {
        maxWidth: 960,
        maxHeight: 720,
        maxChars: 240_000,
      });
      setProductModal((prev) =>
        prev ? { ...prev, draft: { ...prev.draft, imageDataUrl: compressed } } : null
      );
      notify('Product photo uploaded', 'Image ready and compressed for fast store loading.', 'success');
    } catch {
      notify('Upload failed', 'Could not read image file.', 'error');
    }
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userRecord || !categoryModal) return;
    const { draft, isNew } = categoryModal;
    if (draft.name.trim().length < 2) {
      notify('Name required', 'Enter a category name.', 'error');
      return;
    }
    setSavingCategory(true);
    try {
      await saveShopCategory(draft, {
        uid: userRecord.uid,
        email: userRecord.email,
        role: userRecord.role,
      });
      setCategoryModal(null);
      await loadData();
      notify(isNew ? 'Category added' : 'Category updated', draft.name, 'success');
    } catch (err) {
      notify('Save failed', err instanceof Error ? err.message : 'Unable to save category.', 'error');
    } finally {
      setSavingCategory(false);
    }
  };

  const handleDeleteCategory = async (cat: ShopCategoryRecord) => {
    if (!userRecord) return;
    const assignedCount = products.filter((p) => p.categoryId === cat.categoryId).length;
    if (assignedCount > 0) {
      notify(
        'Category has products',
        `Move or delete the ${assignedCount} product(s) inside "${cat.name}" before deleting this category.`,
        'error'
      );
      return;
    }
    const ok = await confirmAction({
      title: 'Delete Shop Category',
      message: `Delete empty category "${cat.name}"?`,
      destructive: true,
      confirmLabel: 'Delete Category',
    });
    if (!ok) return;
    try {
      await deleteShopCategory(cat.categoryId, {
        uid: userRecord.uid,
        email: userRecord.email,
        role: userRecord.role,
      });
      await loadData();
      notify('Category deleted', cat.name, 'success');
    } catch (err) {
      notify('Delete failed', err instanceof Error ? err.message : 'Unable to delete category.', 'error');
    }
  };

  return (
    <PortalLayout portal="admin" title="Shop & Smart Tags Management">
      <div className="space-y-6">
        {/* Top Summary & Tab Switcher */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-[#1D4ED8]" />
              <h2 className="font-display font-bold text-base text-[#0B1D3A]">
                TapNex Smart Tags Storefront Catalog
              </h2>
            </div>
            <p className="text-xs text-slate-600">
              Manage Helmet, Pet, Belongings, Kids, and Find My Owner tags.{' '}
              <strong className="text-[#0B1D3A]">
                {visibleCount} of {products.length} products
              </strong>{' '}
              are currently visible on the customer Shop page.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setTab('products')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  tab === 'products' ? 'bg-[#0B1D3A] text-white' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Products ({products.length})
              </button>
              <button
                type="button"
                onClick={() => setTab('categories')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  tab === 'categories' ? 'bg-[#0B1D3A] text-white' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Categories ({categories.length})
              </button>
            </div>

            {tab === 'products' ? (
              <button
                type="button"
                onClick={() => {
                  const draft = makeEmptyProductDraft(categories, products.length);
                  setProductModal({
                    draft,
                    featuresText: draft.features.join('\n'),
                    isNew: true,
                  });
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1D4ED8] hover:bg-blue-700 text-white text-xs font-semibold whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Product</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() =>
                  setCategoryModal({
                    draft: makeEmptyCategoryDraft(categories.length),
                    isNew: true,
                  })
                }
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1D4ED8] hover:bg-blue-700 text-white text-xs font-semibold whitespace-nowrap"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                <span>Add Category</span>
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="h-56 bg-slate-200 rounded-2xl animate-pulse" />
        ) : tab === 'products' ? (
          <div className="space-y-4">
            {/* Search & Category Filter */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setCategoryFilter('ALL')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap ${
                    categoryFilter === 'ALL'
                      ? 'bg-[#0B1D3A] text-white border-[#0B1D3A]'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  All ({products.length})
                </button>
                {categories.map((c) => {
                  const count = products.filter((p) => p.categoryId === c.categoryId).length;
                  return (
                    <button
                      key={c.categoryId}
                      type="button"
                      onClick={() => setCategoryFilter(c.categoryId)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap ${
                        categoryFilter === c.categoryId
                          ? 'bg-[#0B1D3A] text-white border-[#0B1D3A]'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {c.name} ({count})
                    </button>
                  );
                })}
              </div>

              <div className="relative min-w-[220px]">
                <Search className="h-4 w-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search products..."
                  className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-xs"
                />
              </div>
            </div>

            {/* Products Table */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-3 px-4">Product</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4">Pricing</th>
                    <th className="py-3 px-4">Stock</th>
                    <th className="py-3 px-4">Show on Shop</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredProducts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-slate-400">
                        No products match your filter. Click <strong>Add Product</strong> to create one.
                      </td>
                    </tr>
                  ) : (
                    filteredProducts.map((prod) => (
                      <tr key={prod.productId} className={prod.visibleOnShop ? '' : 'bg-slate-50/70 opacity-85'}>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-16 h-12 rounded-lg border border-slate-200 bg-slate-100 overflow-hidden shrink-0 flex items-center justify-center">
                              {prod.imageDataUrl ? (
                                <img
                                  src={prod.imageDataUrl}
                                  alt={prod.name}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <ImageIcon className="h-4 w-4 text-slate-400" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="font-semibold text-[#0B1D3A] flex items-center gap-1.5">
                                <span className="truncate max-w-[220px]">{prod.name}</span>
                                {prod.featured && (
                                  <span className="px-1.5 py-0.5 rounded bg-blue-50 text-[#1D4ED8] text-[10px] font-semibold">
                                    Featured
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-500 truncate max-w-[260px]">
                                {prod.shortDescription || prod.cardType}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-700 font-medium">{prod.categoryName}</td>
                        <td className="py-3 px-4 font-mono tabular-nums">
                          <div className="font-bold text-[#0B1D3A]">₹{prod.priceInr}</div>
                          {prod.compareAtPriceInr && prod.compareAtPriceInr > prod.priceInr && (
                            <div className="text-[11px] text-slate-400 line-through">₹{prod.compareAtPriceInr}</div>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${
                              prod.inStock ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
                            }`}
                          >
                            {prod.inStock ? 'In Stock' : 'Out of Stock'}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={prod.visibleOnShop}
                              disabled={busyId === prod.productId}
                              onChange={(e) => handleToggleProductVisibility(prod, e.target.checked)}
                              className="h-4 w-4 accent-[#1D4ED8] rounded"
                            />
                            <span
                              className={`inline-flex items-center gap-1 font-semibold ${
                                prod.visibleOnShop ? 'text-emerald-700' : 'text-slate-500'
                              }`}
                            >
                              {prod.visibleOnShop ? (
                                <>
                                  <Eye className="h-3.5 w-3.5" />
                                  <span>Shown</span>
                                </>
                              ) : (
                                <>
                                  <EyeOff className="h-3.5 w-3.5" />
                                  <span>Hidden</span>
                                </>
                              )}
                            </span>
                          </label>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                          <button
                            type="button"
                            onClick={() =>
                              setProductModal({
                                draft: JSON.parse(JSON.stringify(prod)) as ShopProductRecord,
                                featuresText: (prod.features || []).join('\n'),
                                isNew: false,
                              })
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold text-[#0B1D3A] hover:bg-slate-50"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            disabled={busyId === prod.productId}
                            onClick={() => handleDeleteProduct(prod)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-rose-200 text-rose-600 rounded-lg text-xs font-semibold hover:bg-rose-50 disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>Delete</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* Categories Management */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {categories.map((cat) => {
              const count = products.filter((p) => p.categoryId === cat.categoryId).length;
              return (
                <div
                  key={cat.categoryId}
                  className={`bg-white border rounded-2xl p-5 flex flex-col justify-between gap-4 ${
                    cat.active ? 'border-slate-200' : 'border-slate-200 bg-slate-50 opacity-80'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-mono text-slate-500">
                        <Tag className="h-3.5 w-3.5 text-[#1D4ED8]" />
                        <span>#{cat.sortOrder} · {cat.slug}</span>
                      </span>
                      <label className="inline-flex items-center gap-1.5 text-xs font-semibold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={cat.active}
                          onChange={async (e) => {
                            if (!userRecord) return;
                            await saveShopCategory(
                              { ...cat, active: e.target.checked },
                              { uid: userRecord.uid, email: userRecord.email, role: userRecord.role }
                            );
                            await loadData();
                            notify(
                              e.target.checked ? 'Category enabled' : 'Category hidden',
                              cat.name,
                              'info'
                            );
                          }}
                          className="h-4 w-4 accent-[#1D4ED8]"
                        />
                        <span>{cat.active ? 'Active' : 'Hidden'}</span>
                      </label>
                    </div>
                    <h3 className="font-display font-bold text-base text-[#0B1D3A]">{cat.name}</h3>
                    <p className="text-xs text-slate-600">{cat.description || 'No description provided.'}</p>
                    <div className="text-[11px] font-mono text-slate-500">{count} product(s)</div>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() =>
                        setCategoryModal({
                          draft: { ...cat },
                          isNew: false,
                        })
                      }
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#1D4ED8] hover:underline"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      <span>Edit Category</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteCategory(cat)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:underline"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add / Edit Product Modal */}
      {productModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleSaveProduct}
            className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden my-auto"
          >
            <div className="px-6 py-4 bg-[#0B1D3A] text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckSquare className="h-4 w-4 text-cyan-300" />
                <h3 className="font-display font-bold text-base">
                  {productModal.isNew ? 'Add New Shop Product' : `Edit Product — ${productModal.draft.name}`}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setProductModal(null)}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[78vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Product Name *</label>
                  <input
                    type="text"
                    required
                    minLength={2}
                    maxLength={120}
                    value={productModal.draft.name}
                    onChange={(e) =>
                      setProductModal({
                        ...productModal,
                        draft: { ...productModal.draft, name: e.target.value },
                      })
                    }
                    placeholder="e.g. TapNex Helmet Emergency QR Sticker"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Category *</label>
                  <select
                    value={productModal.draft.categoryId}
                    onChange={(e) => {
                      const cat = categories.find((c) => c.categoryId === e.target.value);
                      setProductModal({
                        ...productModal,
                        draft: {
                          ...productModal.draft,
                          categoryId: e.target.value,
                          categoryName: cat?.name || productModal.draft.categoryName,
                        },
                      });
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                  >
                    {categories.map((c) => (
                      <option key={c.categoryId} value={c.categoryId}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Selling Price (INR) *</label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={productModal.draft.priceInr}
                    onChange={(e) =>
                      setProductModal({
                        ...productModal,
                        draft: { ...productModal.draft, priceInr: Number(e.target.value) },
                      })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Compare-At MRP (INR, optional)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={productModal.draft.compareAtPriceInr || 0}
                    onChange={(e) =>
                      setProductModal({
                        ...productModal,
                        draft: { ...productModal.draft, compareAtPriceInr: Number(e.target.value) },
                      })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Material / Tag Type</label>
                  <input
                    type="text"
                    maxLength={80}
                    value={productModal.draft.cardType || ''}
                    onChange={(e) =>
                      setProductModal({
                        ...productModal,
                        draft: { ...productModal.draft, cardType: e.target.value },
                      })
                    }
                    placeholder="e.g. 3M Waterproof Decal / Anodized Metal Tag"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Badge Label</label>
                    <input
                      type="text"
                      maxLength={32}
                      value={productModal.draft.badgeText || ''}
                      onChange={(e) =>
                        setProductModal({
                          ...productModal,
                          draft: { ...productModal.draft, badgeText: e.target.value },
                        })
                      }
                      placeholder="Bestseller"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Sort Order</label>
                    <input
                      type="number"
                      min={1}
                      value={productModal.draft.sortOrder || 1}
                      onChange={(e) =>
                        setProductModal({
                          ...productModal,
                          draft: { ...productModal.draft, sortOrder: Number(e.target.value) },
                        })
                      }
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Product Image Upload + Preview */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <div className="w-32 aspect-[4/3] rounded-lg border border-slate-200 bg-white overflow-hidden shrink-0 flex items-center justify-center">
                  {productModal.draft.imageDataUrl ? (
                    <img
                      src={productModal.draft.imageDataUrl}
                      alt={productModal.draft.name || 'Preview'}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <ImageIcon className="h-6 w-6 text-slate-400" />
                  )}
                </div>
                <div className="space-y-2 flex-1 min-w-0">
                  <div className="text-xs font-semibold text-[#0B1D3A]">Product Image (4:3 recommended)</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0B1D3A] text-white text-xs font-semibold cursor-pointer hover:bg-[#132A52]">
                      <Upload className="h-3.5 w-3.5" />
                      <span>Upload Photo</span>
                      <input type="file" accept="image/*" className="hidden" onChange={handleUploadProductImage} />
                    </label>
                    {productModal.draft.imageDataUrl && (
                      <button
                        type="button"
                        onClick={() =>
                          setProductModal({
                            ...productModal,
                            draft: { ...productModal.draft, imageDataUrl: '' },
                          })
                        }
                        className="px-2.5 py-1.5 border border-rose-200 bg-white text-rose-600 rounded-lg text-xs font-semibold"
                      >
                        Remove Photo
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={productModal.draft.imageDataUrl}
                    onChange={(e) =>
                      setProductModal({
                        ...productModal,
                        draft: { ...productModal.draft, imageDataUrl: e.target.value },
                      })
                    }
                    placeholder="Or paste /assets/images/... image path"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-[11px] bg-white font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Short Summary</label>
                <input
                  type="text"
                  maxLength={160}
                  value={productModal.draft.shortDescription || ''}
                  onChange={(e) =>
                    setProductModal({
                      ...productModal,
                      draft: { ...productModal.draft, shortDescription: e.target.value },
                    })
                  }
                  placeholder="One-line summary shown on the product card..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Full Description</label>
                <textarea
                  rows={3}
                  maxLength={800}
                  value={productModal.draft.description || ''}
                  onChange={(e) =>
                    setProductModal({
                      ...productModal,
                      draft: { ...productModal.draft, description: e.target.value },
                    })
                  }
                  placeholder="Detailed description of materials, use case, and TapNex smart profile linking..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Key Features (one feature per line)
                </label>
                <textarea
                  rows={4}
                  value={productModal.featuresText}
                  onChange={(e) => setProductModal({ ...productModal, featuresText: e.target.value })}
                  placeholder={'Waterproof 3M adhesive\nInstant emergency contact scan\nNo app required'}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                />
              </div>

              <div className="flex flex-wrap gap-5 pt-2 border-t border-slate-100">
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#0B1D3A] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={productModal.draft.visibleOnShop}
                    onChange={(e) =>
                      setProductModal({
                        ...productModal,
                        draft: { ...productModal.draft, visibleOnShop: e.target.checked },
                      })
                    }
                    className="h-4 w-4 accent-[#1D4ED8]"
                  />
                  <span>Show on Shop (Visible to Customers)</span>
                </label>
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={productModal.draft.inStock}
                    onChange={(e) =>
                      setProductModal({
                        ...productModal,
                        draft: { ...productModal.draft, inStock: e.target.checked },
                      })
                    }
                    className="h-4 w-4 accent-emerald-600"
                  />
                  <span>In Stock</span>
                </label>
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(productModal.draft.featured)}
                    onChange={(e) =>
                      setProductModal({
                        ...productModal,
                        draft: { ...productModal.draft, featured: e.target.checked },
                      })
                    }
                    className="h-4 w-4 accent-[#1D4ED8]"
                  />
                  <span>Featured Product</span>
                </label>
              </div>
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setProductModal(null)}
                className="px-4 py-2 border border-slate-300 bg-white rounded-lg text-xs font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingProduct}
                className="px-5 py-2 bg-[#0B1D3A] hover:bg-[#132A52] text-white rounded-lg text-xs font-semibold disabled:opacity-50"
              >
                {savingProduct ? 'Saving...' : productModal.isNew ? 'Create Product' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Add / Edit Category Modal */}
      {categoryModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleSaveCategory}
            className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
          >
            <div className="px-6 py-4 bg-[#0B1D3A] text-white flex items-center justify-between">
              <h3 className="font-display font-bold text-base">
                {categoryModal.isNew ? 'Add Shop Category' : `Edit Category — ${categoryModal.draft.name}`}
              </h3>
              <button
                type="button"
                onClick={() => setCategoryModal(null)}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Category Name *</label>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={80}
                  value={categoryModal.draft.name}
                  onChange={(e) =>
                    setCategoryModal({
                      ...categoryModal,
                      draft: { ...categoryModal.draft, name: e.target.value },
                    })
                  }
                  placeholder="e.g. Helmet Tags / Stickers"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Slug</label>
                  <input
                    type="text"
                    maxLength={64}
                    value={categoryModal.draft.slug}
                    onChange={(e) =>
                      setCategoryModal({
                        ...categoryModal,
                        draft: { ...categoryModal.draft, slug: e.target.value },
                      })
                    }
                    placeholder="helmet-tags"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Sort Order</label>
                  <input
                    type="number"
                    min={1}
                    value={categoryModal.draft.sortOrder}
                    onChange={(e) =>
                      setCategoryModal({
                        ...categoryModal,
                        draft: { ...categoryModal.draft, sortOrder: Number(e.target.value) },
                      })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  maxLength={240}
                  value={categoryModal.draft.description || ''}
                  onChange={(e) =>
                    setCategoryModal({
                      ...categoryModal,
                      draft: { ...categoryModal.draft, description: e.target.value },
                    })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                />
              </div>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#0B1D3A] cursor-pointer">
                <input
                  type="checkbox"
                  checked={categoryModal.draft.active}
                  onChange={(e) =>
                    setCategoryModal({
                      ...categoryModal,
                      draft: { ...categoryModal.draft, active: e.target.checked },
                    })
                  }
                  className="h-4 w-4 accent-[#1D4ED8]"
                />
                <span>Active on Customer Shop</span>
              </label>
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setCategoryModal(null)}
                className="px-4 py-2 border border-slate-300 bg-white rounded-lg text-xs font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingCategory}
                className="px-5 py-2 bg-[#0B1D3A] hover:bg-[#132A52] text-white rounded-lg text-xs font-semibold disabled:opacity-50"
              >
                {savingCategory ? 'Saving...' : 'Save Category'}
              </button>
            </div>
          </form>
        </div>
      )}
    </PortalLayout>
  );
};
