import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  Baby,
  Check,
  Copy,
  CreditCard,
  ExternalLink,
  Eye,
  Globe,
  Loader2,
  Lock,
  MoreHorizontal,
  Package,
  PawPrint,
  Plus,
  SlidersHorizontal,
  Tag,
  Trash2,
  User,
  UserCheck,
  UserRoundPen,
} from 'lucide-react';
import { PROFILE_TYPE_OPTIONS } from '../lib/constants';
import { isOrderPaymentConfirmed } from '../lib/firestoreService';
import type {
  CardDesignRecord,
  OrderRecord,
  ProfileRecord,
  ProfileType,
} from '../types';

export interface CustomerOverviewDashboardProps {
  loading: boolean;
  profiles: ProfileRecord[];
  activeProfile: ProfileRecord | null;
  orders: OrderRecord[];
  designs: CardDesignRecord[];
  activeDesign: CardDesignRecord | null;
  completion: number;
  hasPaid: boolean;
  isDisabledByAdmin: boolean;
  publicUrl: string;
  multipleProfilesEnabled: boolean;
  createProfileType: ProfileType;
  deletingProfileId?: string | null;
  onChangeCreateProfileType: (type: ProfileType) => void;
  onOpenCreateModal: () => void;
  onSelectProfile: (profileId: string) => void;
  onOpenPreview: () => void;
  onOpenCardPreview: () => void;
  onEditProfile: () => void;
  onControlVisibility: () => void;
  onCopyUrl: (url: string) => Promise<void> | void;
  onDeleteProfile: (profile: ProfileRecord) => Promise<void> | void;
}

function getProfileTypeIcon(type?: ProfileType) {
  switch (type) {
    case 'kids':
      return Baby;
    case 'pets':
      return PawPrint;
    case 'belongings':
      return Tag;
    case 'adult':
    default:
      return User;
  }
}

function getProfileTypeMeta(type?: ProfileType) {
  return PROFILE_TYPE_OPTIONS.find((opt) => opt.id === (type || 'adult')) || PROFILE_TYPE_OPTIONS[0];
}

export interface CustomerOverviewDashboardViewProps extends CustomerOverviewDashboardProps {
  copiedKey: 'toolbar' | 'summary' | null;
  mobileMenuOpen: boolean;
  mobileMenuRef?: React.RefObject<HTMLDivElement | null>;
  onToggleMobileMenu: () => void;
  onCloseMobileMenu: () => void;
  onHandleCopy: (source: 'toolbar' | 'summary') => Promise<void> | void;
}

export const CustomerOverviewDashboard: React.FC<CustomerOverviewDashboardProps> = (props) => {
  const [copiedKey, setCopiedKey] = useState<'toolbar' | 'summary' | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [props.activeProfile?.profileId]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target as Node)) {
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [mobileMenuOpen]);

  const canCopyPublicUrl = Boolean(
    props.publicUrl && props.hasPaid && props.activeProfile?.isPublic && !props.isDisabledByAdmin
  );

  const handleCopy = async (source: 'toolbar' | 'summary') => {
    if (!canCopyPublicUrl) return;
    await props.onCopyUrl(props.publicUrl);
    setCopiedKey(source);
    globalThis.setTimeout(() => {
      setCopiedKey((prev) => (prev === source ? null : prev));
    }, 2000);
  };

  return (
    <CustomerOverviewDashboardView
      {...props}
      copiedKey={copiedKey}
      mobileMenuOpen={mobileMenuOpen}
      mobileMenuRef={mobileMenuRef}
      onToggleMobileMenu={() => setMobileMenuOpen((prev) => !prev)}
      onCloseMobileMenu={() => setMobileMenuOpen(false)}
      onHandleCopy={handleCopy}
    />
  );
};

export const CustomerOverviewDashboardView: React.FC<CustomerOverviewDashboardViewProps> = ({
  loading,
  profiles,
  activeProfile,
  orders,
  designs,
  activeDesign,
  completion,
  hasPaid,
  isDisabledByAdmin,
  publicUrl,
  multipleProfilesEnabled,
  createProfileType,
  deletingProfileId = null,
  onChangeCreateProfileType,
  onOpenCreateModal,
  onSelectProfile,
  onOpenPreview,
  onOpenCardPreview,
  onEditProfile,
  onControlVisibility,
  onDeleteProfile,
  copiedKey,
  mobileMenuOpen,
  mobileMenuRef,
  onToggleMobileMenu,
  onCloseMobileMenu,
  onHandleCopy,
}) => {
  const latestOrder = orders[0];
  const canCreateProfiles = multipleProfilesEnabled || profiles.length === 0;
  const canCopyPublicUrl = Boolean(publicUrl && hasPaid && activeProfile?.isPublic && !isDisabledByAdmin);

  if (loading) {
    return (
      <div className="space-y-6 lg:space-y-7" aria-busy="true" aria-label="Loading dashboard overview">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-36 bg-white border border-[#E9E4F5] rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-80 bg-white border border-[#E9E4F5] rounded-2xl animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-44 bg-white border border-[#E9E4F5] rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const activeMeta = getProfileTypeMeta(activeProfile?.profileType);
  const activePaymentConfirmed = isOrderPaymentConfirmed(
    orders,
    activeProfile?.profileId,
    activeProfile?.slug
  );

  const digitalProfileStatus = !activeProfile
    ? {
        label: 'No Profile Selected',
        badgeClass: 'bg-slate-100 text-[#64607D] border-[#E9E4F5]',
      }
    : isDisabledByAdmin
      ? {
          label: 'Disabled by Admin',
          badgeClass: 'bg-rose-50 text-[#E11D48] border-rose-200',
        }
      : !activeProfile.isPublic
        ? {
            label: 'Paused / Private',
            badgeClass: 'bg-slate-100 text-[#64607D] border-[#E9E4F5]',
          }
        : hasPaid
          ? activeProfile.adminApproved && !activePaymentConfirmed
            ? {
                label: 'Approved by Admin (Live)',
                badgeClass: 'bg-emerald-50 text-[#059669] border-emerald-200',
              }
            : {
                label: 'Published & Active',
                badgeClass: 'bg-emerald-50 text-[#059669] border-emerald-200',
              }
          : {
              label: 'Payment Pending (Locked)',
              badgeClass: 'bg-amber-50 text-[#D97706] border-amber-200',
            };

  const isDeletingActive = Boolean(activeProfile && deletingProfileId === activeProfile.profileId);

  return (
    <div className="space-y-6 lg:space-y-8">
      {/* 1. Top 4 Summary Cards */}
      <section aria-label="Account summary metrics">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-5">
          {/* Card 1: Profile Completion */}
          <div className="bg-white border border-[#E9E4F5] rounded-xl p-5 sm:p-6 shadow-[0_1px_2px_rgba(11,29,58,0.04)] flex flex-col justify-between min-h-[148px]">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-[#64607D]">Profile Completion</span>
              <span className="h-8 w-8 rounded-lg bg-[#F3EEFF] border border-[#E9E4F5] flex items-center justify-center text-[#7C3AED] shrink-0">
                <UserCheck className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-display text-2xl font-bold text-[#18142C] tabular-nums">
                  {completion}%
                </span>
                <span className="text-xs text-[#64607D]">
                  {completion >= 100 ? 'Complete' : 'Ready to update'}
                </span>
              </div>
              <div
                className="mt-2.5 w-full h-2 bg-slate-100 rounded-md overflow-hidden"
                role="progressbar"
                aria-valuenow={completion}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Profile completion percentage"
              >
                <div
                  className={`h-full rounded-md transition-all duration-300 ${
                    completion >= 100 ? 'bg-[#059669]' : 'bg-[#7C3AED]'
                  }`}
                  style={{ width: `${completion}%` }}
                />
              </div>
            </div>
          </div>

          {/* Card 2: Digital Profile Status */}
          <div className="bg-white border border-[#E9E4F5] rounded-xl p-5 sm:p-6 shadow-[0_1px_2px_rgba(11,29,58,0.04)] flex flex-col justify-between min-h-[148px]">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-[#64607D]">Digital Profile Status</span>
              <span className="h-8 w-8 rounded-lg bg-[#F3EEFF] border border-[#E9E4F5] flex items-center justify-center text-[#18142C] shrink-0">
                <Globe className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-3 space-y-2 min-w-0">
              <span
                className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold border ${digitalProfileStatus.badgeClass}`}
              >
                {digitalProfileStatus.label}
              </span>
              {activeProfile && hasPaid && activeProfile.isPublic && !isDisabledByAdmin ? (
                <a
                  href={`/p/${activeProfile.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`/p/${activeProfile.slug}`}
                  className="flex items-center gap-1.5 text-xs font-mono font-medium text-[#7C3AED] hover:underline min-w-0"
                >
                  <span className="truncate">/p/{activeProfile.slug}</span>
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              ) : activeProfile ? (
                <button
                  type="button"
                  onClick={onOpenPreview}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#7C3AED] hover:underline cursor-pointer"
                >
                  <Eye className="h-3.5 w-3.5 shrink-0" />
                  <span>View Watermarked Preview</span>
                </button>
              ) : (
                <p className="text-xs text-[#64607D]">Create a profile to get started</p>
              )}
            </div>
          </div>

          {/* Card 3: Latest Card & Order Status */}
          <div className="bg-white border border-[#E9E4F5] rounded-xl p-5 sm:p-6 shadow-[0_1px_2px_rgba(11,29,58,0.04)] flex flex-col justify-between min-h-[148px]">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-[#64607D]">Latest Card &amp; Order Status</span>
              <span className="h-8 w-8 rounded-lg bg-[#F3EEFF] border border-[#E9E4F5] flex items-center justify-center text-[#18142C] shrink-0">
                <Package className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-3 space-y-2 min-w-0">
              <div
                className="font-display text-base font-bold text-[#18142C] truncate"
                title={
                  latestOrder
                    ? latestOrder.orderStatus
                    : designs.length > 0
                      ? 'Design Saved'
                      : 'Not Ordered Yet'
                }
              >
                {latestOrder
                  ? latestOrder.orderStatus
                  : designs.length > 0
                    ? 'Design Saved'
                    : 'Not Ordered Yet'}
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-[#64607D]">
                <span className="font-mono tabular-nums truncate">
                  {latestOrder
                    ? `${latestOrder.orderNumber} · ₹${latestOrder.total}`
                    : '85.6 × 54 mm Ready'}
                </span>
                {activeDesign && (
                  <button
                    type="button"
                    onClick={onOpenCardPreview}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[#E9E4F5] bg-[#F3EEFF] hover:bg-slate-200/70 text-xs font-semibold text-[#7C3AED] whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                  >
                    <CreditCard className="h-3 w-3" />
                    <span>Preview Card</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Card 4: Profile & Smart Tap Visits */}
          <div className="bg-white border border-[#E9E4F5] rounded-xl p-5 sm:p-6 shadow-[0_1px_2px_rgba(11,29,58,0.04)] flex flex-col justify-between min-h-[148px]">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-[#64607D]">Profile &amp; Smart Tap Visits</span>
              <span className="h-8 w-8 rounded-lg bg-[#F3EEFF] border border-[#E9E4F5] flex items-center justify-center text-[#18142C] shrink-0">
                <Activity className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-3 space-y-1">
              <div className="font-display text-2xl font-bold text-[#18142C] tabular-nums">
                {activeProfile?.viewsCount ?? 0}
              </div>
              <p className="text-xs text-[#64607D] leading-snug">
                QR/SMART visits resolve after card activation
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Your Digital Profiles Management Panel */}
      <section
        aria-label="Your Digital Profiles"
        className="bg-white border border-[#E9E4F5] rounded-2xl p-5 sm:p-6 shadow-[0_1px_2px_rgba(11,29,58,0.04)] space-y-6"
      >
        {/* A. Section Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="font-display text-lg font-bold text-[#18142C]">
                Your Digital Profiles
              </h2>
              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-[#F3EEFF] border border-[#E9E4F5] text-xs font-medium text-[#64607D] tabular-nums">
                {profiles.length} {profiles.length === 1 ? 'profile' : 'profiles'}
              </span>
            </div>
            <p className="text-sm text-[#64607D]">
              Manage your personal, business, pet, and belongings profiles from one place.
            </p>
          </div>

          {canCreateProfiles && (
            <button
              type="button"
              onClick={onOpenCreateModal}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold shadow-xs transition-colors whitespace-nowrap shrink-0 min-h-[40px] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7C3AED]"
            >
              <Plus className="h-4 w-4" />
              <span>Create New Profile</span>
            </button>
          )}
        </div>

        {/* B. Profile Creation Strip */}
        {canCreateProfiles && (
          <div className="bg-[#FAF9FE] border border-[#E9E4F5] rounded-xl p-3.5 sm:px-4 sm:py-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <p className="text-xs text-[#64607D]">
              Select a profile type to set up a dedicated digital identity or recovery tag.
            </p>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 shrink-0">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <label
                  htmlFor="overview-profile-type-select"
                  className="text-xs font-semibold text-[#18142C] whitespace-nowrap"
                >
                  Profile Type
                </label>
                <select
                  id="overview-profile-type-select"
                  value={createProfileType}
                  onChange={(e) => onChangeCreateProfileType(e.target.value as ProfileType)}
                  className="w-full sm:w-52 px-3 py-2 border border-[#E9E4F5] rounded-lg text-xs font-semibold bg-white text-[#18142C] min-h-[40px] focus:border-[#7C3AED] focus:outline-none"
                >
                  {PROFILE_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={onOpenCreateModal}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#18142C] hover:bg-[#2A2048] text-white text-xs font-semibold transition-colors whitespace-nowrap min-h-[40px] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#18142C]"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Create Profile</span>
              </button>
            </div>
          </div>
        )}

        {/* C. Profile Selector Grid */}
        {profiles.length === 0 ? (
          <div className="border border-dashed border-[#E9E4F5] rounded-xl p-8 text-center space-y-3 bg-[#FAF9FE]">
            <p className="text-sm font-medium text-[#18142C]">No digital profiles created yet</p>
            <p className="text-xs text-[#64607D] max-w-md mx-auto">
              Create your first profile to configure your digital card, customize public visibility, and unlock your live sharing link.
            </p>
            {canCreateProfiles && (
              <button
                type="button"
                onClick={onOpenCreateModal}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                <span>Create First Profile</span>
              </button>
            )}
          </div>
        ) : (
          <div
            role="list"
            aria-label="Digital profiles list"
            className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5"
          >
            {profiles.map((p) => {
              const selected = p.profileId === activeProfile?.profileId;
              const pPaid =
                isOrderPaymentConfirmed(orders, p.profileId, p.slug) ||
                Boolean(p.adminApproved) ||
                Boolean(p.paymentConfirmed);
              const meta = getProfileTypeMeta(p.profileType);
              const TypeIcon = getProfileTypeIcon(p.profileType);
              const displayName = p.profileLabel || meta.defaultLabel;
              const slugLabel = `/p/${p.slug}`;

              const cardStatus = p.adminDisabled
                ? {
                    label: 'Disabled',
                    className: 'bg-rose-50 text-[#E11D48] border-rose-200',
                  }
                : !pPaid
                  ? {
                      label: 'Unpaid Preview',
                      className: 'bg-amber-50 text-[#D97706] border-amber-200',
                    }
                  : !p.isPublic
                    ? {
                        label: 'Unpublished',
                        className: 'bg-slate-100 text-[#64607D] border-[#E9E4F5]',
                      }
                    : {
                        label: 'Active',
                        className: 'bg-emerald-50 text-[#059669] border-emerald-200',
                      };

              return (
                <button
                  key={p.profileId}
                  type="button"
                  onClick={() => onSelectProfile(p.profileId)}
                  aria-pressed={selected}
                  className={`group text-left rounded-xl p-4 border transition-all duration-150 flex flex-col justify-between gap-3.5 min-h-[124px] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7C3AED] ${
                    selected
                      ? 'border-[#7C3AED] bg-[#7C3AED]/[0.04] ring-1 ring-[#7C3AED]/25'
                      : 'border-[#E9E4F5] bg-white hover:border-slate-300 hover:bg-slate-50/70'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <span
                        className={`h-9 w-9 rounded-lg border flex items-center justify-center shrink-0 transition-colors ${
                          selected
                            ? 'bg-[#7C3AED] text-white border-[#7C3AED]'
                            : 'bg-[#F3EEFF] text-[#18142C] border-[#E9E4F5]'
                        }`}
                      >
                        <TypeIcon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div
                          className="font-display text-sm font-bold text-[#18142C] truncate"
                          title={displayName}
                        >
                          {displayName}
                        </div>
                        <div className="text-xs text-[#64607D] mt-0.5">{meta.label}</div>
                      </div>
                    </div>

                    {selected ? (
                      <span
                        className="h-5 w-5 rounded-md bg-[#7C3AED] text-white flex items-center justify-center shrink-0"
                        title="Selected profile"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span className="sr-only">Selected</span>
                      </span>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#E9E4F5]/80 min-w-0">
                    <span
                      className="font-mono text-xs text-[#64607D] truncate"
                      title={slugLabel}
                    >
                      {slugLabel}
                    </span>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border whitespace-nowrap shrink-0 ${cardStatus.className}`}
                    >
                      {cardStatus.label}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* D & E. Selected Profile Action Toolbar & Summary */}
        {activeProfile && (
          <div className="border-t border-[#E9E4F5] pt-5 space-y-5">
            {/* D. Selected Profile Action Toolbar */}
            <div className="space-y-2.5">
              <div className="text-xs font-semibold text-[#64607D]">
                Actions for {activeProfile.profileLabel || activeMeta.defaultLabel}
              </div>

              {/* Desktop & Tablet Toolbar */}
              <div className="hidden sm:flex sm:flex-wrap sm:items-center gap-2.5">
                <button
                  type="button"
                  onClick={onEditProfile}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold transition-colors whitespace-nowrap min-h-[38px] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7C3AED]"
                >
                  <UserRoundPen className="h-3.5 w-3.5" />
                  <span>Edit Profile</span>
                </button>

                <button
                  type="button"
                  onClick={onOpenPreview}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#E9E4F5] bg-white hover:bg-slate-50 text-[#18142C] text-xs font-semibold transition-colors whitespace-nowrap min-h-[38px] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7C3AED]"
                >
                  <Eye className="h-3.5 w-3.5 text-[#64607D]" />
                  <span>Preview Profile</span>
                </button>

                <button
                  type="button"
                  disabled={!activeDesign}
                  title={
                    activeDesign
                      ? 'Preview customized 85.6 × 54 mm smart card design'
                      : 'Customize and save a card design to preview it here'
                  }
                  onClick={onOpenCardPreview}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#E9E4F5] bg-white hover:bg-slate-50 text-[#18142C] text-xs font-semibold transition-colors whitespace-nowrap min-h-[38px] cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7C3AED]"
                >
                  <CreditCard className="h-3.5 w-3.5 text-[#64607D]" />
                  <span>Preview Card Design</span>
                </button>

                <button
                  type="button"
                  onClick={onControlVisibility}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#E9E4F5] bg-white hover:bg-slate-50 text-[#18142C] text-xs font-semibold transition-colors whitespace-nowrap min-h-[38px] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7C3AED]"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5 text-[#64607D]" />
                  <span>Control Public Visibility</span>
                </button>

                <button
                  type="button"
                  disabled={!canCopyPublicUrl}
                  title={
                    canCopyPublicUrl
                      ? 'Copy public profile URL'
                      : 'Complete payment and publish profile to unlock URL copying'
                  }
                  onClick={() => void onHandleCopy('toolbar')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#F3EEFF] hover:bg-slate-200/70 text-[#18142C] text-xs font-semibold transition-colors whitespace-nowrap min-h-[38px] cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7C3AED]"
                >
                  {copiedKey === 'toolbar' ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-[#059669]" />
                      <span className="text-[#059669]">Copied URL</span>
                    </>
                  ) : canCopyPublicUrl ? (
                    <>
                      <Copy className="h-3.5 w-3.5 text-[#64607D]" />
                      <span>Copy Profile URL</span>
                    </>
                  ) : (
                    <>
                      <Lock className="h-3.5 w-3.5 text-[#D97706]" />
                      <span>Copy Profile URL</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  disabled={isDeletingActive}
                  onClick={() => void onDeleteProfile(activeProfile)}
                  className="sm:ml-auto inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-rose-200 bg-white hover:bg-rose-50 text-[#E11D48] text-xs font-semibold transition-colors whitespace-nowrap min-h-[38px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E11D48]"
                >
                  {isDeletingActive ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  <span>{isDeletingActive ? 'Deleting...' : 'Delete Profile'}</span>
                </button>
              </div>

                {/* Mobile Compact Toolbar + More Actions Menu */}
              <div className="flex sm:hidden items-center gap-2 relative" ref={mobileMenuRef}>
                <button
                  type="button"
                  onClick={onEditProfile}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-semibold min-h-[44px] cursor-pointer"
                >
                  <UserRoundPen className="h-4 w-4" />
                  <span>Edit Profile</span>
                </button>

                <button
                  type="button"
                  onClick={onOpenPreview}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-lg border border-[#E9E4F5] bg-white text-[#18142C] text-xs font-semibold min-h-[44px] cursor-pointer"
                >
                  <Eye className="h-4 w-4 text-[#64607D]" />
                  <span>Preview</span>
                </button>

                <button
                  type="button"
                  aria-expanded={mobileMenuOpen}
                  aria-haspopup="menu"
                  aria-label="More profile actions"
                  onClick={onToggleMobileMenu}
                  className="inline-flex items-center justify-center px-3 py-2.5 rounded-lg border border-[#E9E4F5] bg-white text-[#18142C] min-h-[44px] min-w-[44px] cursor-pointer"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>

                {mobileMenuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 top-12 z-20 w-60 bg-white border border-[#E9E4F5] rounded-xl shadow-lg p-1.5 space-y-1"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!activeDesign}
                      onClick={() => {
                        onCloseMobileMenu();
                        onOpenCardPreview();
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium text-[#18142C] hover:bg-[#F3EEFF] disabled:opacity-45 text-left"
                    >
                      <CreditCard className="h-4 w-4 text-[#64607D]" />
                      <span>Preview Card Design</span>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onCloseMobileMenu();
                        onControlVisibility();
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium text-[#18142C] hover:bg-[#F3EEFF] text-left"
                    >
                      <SlidersHorizontal className="h-4 w-4 text-[#64607D]" />
                      <span>Control Public Visibility</span>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      disabled={!canCopyPublicUrl}
                      onClick={() => {
                        onCloseMobileMenu();
                        void onHandleCopy('toolbar');
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium text-[#18142C] hover:bg-[#F3EEFF] disabled:opacity-45 text-left"
                    >
                      {canCopyPublicUrl ? (
                        <Copy className="h-4 w-4 text-[#64607D]" />
                      ) : (
                        <Lock className="h-4 w-4 text-[#D97706]" />
                      )}
                      <span>Copy Profile URL</span>
                    </button>

                    <div className="border-t border-[#E9E4F5] my-1" />

                    <button
                      type="button"
                      role="menuitem"
                      disabled={isDeletingActive}
                      onClick={() => {
                        onCloseMobileMenu();
                        void onDeleteProfile(activeProfile);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-semibold text-[#E11D48] hover:bg-rose-50 disabled:opacity-50 text-left"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span>{isDeletingActive ? 'Deleting...' : 'Delete Profile'}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* E. Selected Profile Information */}
            <div className="bg-[#FAF9FE] border border-[#E9E4F5] rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-[#64607D]">Profile Name</div>
                <div
                  className="mt-1 text-xs font-semibold text-[#18142C] truncate"
                  title={activeProfile.profileLabel || activeMeta.defaultLabel}
                >
                  {activeProfile.profileLabel || activeMeta.defaultLabel}
                </div>
              </div>

              <div className="min-w-0">
                <div className="text-[11px] font-medium text-[#64607D]">Category</div>
                <div className="mt-1 text-xs font-semibold text-[#18142C]">
                  {activeMeta.label}
                </div>
              </div>

              <div className="min-w-0 lg:col-span-1">
                <div className="text-[11px] font-medium text-[#64607D]">Public URL</div>
                <div className="mt-1 flex items-center gap-1.5 min-w-0">
                  {canCopyPublicUrl ? (
                    <a
                      href={`/p/${activeProfile.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`/p/${activeProfile.slug}`}
                      className="font-mono text-xs font-medium text-[#7C3AED] hover:underline truncate"
                    >
                      /p/{activeProfile.slug}
                    </a>
                  ) : (
                    <span
                      className="font-mono text-xs text-[#64607D] truncate"
                      title={`/p/${activeProfile.slug}`}
                    >
                      /p/{activeProfile.slug}
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={!canCopyPublicUrl}
                    onClick={() => void onHandleCopy('summary')}
                    aria-label={canCopyPublicUrl ? 'Copy public URL' : 'Public URL locked until active'}
                    title={
                      canCopyPublicUrl
                        ? 'Copy public profile URL'
                        : 'Unlock via payment or admin approval to copy live URL'
                    }
                    className="p-1 rounded-md text-[#64607D] hover:text-[#18142C] hover:bg-slate-200/70 disabled:opacity-40 disabled:cursor-not-allowed shrink-0 cursor-pointer"
                  >
                    {copiedKey === 'summary' ? (
                      <Check className="h-3.5 w-3.5 text-[#059669]" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>

              <div className="min-w-0">
                <div className="text-[11px] font-medium text-[#64607D]">Publication Status</div>
                <div className="mt-1 text-xs font-semibold text-[#18142C]">
                  {hasPaid ? 'Active & Unlocked' : 'Unpaid Preview'}
                </div>
              </div>

              <div className="min-w-0">
                <div className="text-[11px] font-medium text-[#64607D]">Visibility Status</div>
                <div className="mt-1 text-xs font-semibold text-[#18142C]">
                  {isDisabledByAdmin
                    ? 'Disabled by Admin'
                    : activeProfile.isPublic
                      ? 'Public (Visible)'
                      : 'Paused / Private'}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 3. Manage Your Profile Quick Action Cards */}
      <section aria-label="Manage Your Profile" className="space-y-4">
        <div>
          <h2 className="font-display text-lg font-bold text-[#18142C]">Manage Your Profile</h2>
          <p className="text-sm text-[#64607D] mt-0.5">
            Quickly access the tools you need to manage your digital identity.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
          <Link
            to="/dashboard/profile"
            className="group bg-white border border-[#E9E4F5] hover:border-[#7C3AED] rounded-xl p-5 sm:p-6 shadow-[0_1px_2px_rgba(11,29,58,0.04)] transition-all duration-150 flex flex-col justify-between gap-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7C3AED]"
          >
            <div className="space-y-3">
              <div className="h-10 w-10 rounded-lg bg-[#7C3AED]/10 text-[#7C3AED] flex items-center justify-center">
                <UserRoundPen className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-display text-sm font-bold text-[#18142C]">Edit Profile</h3>
                <p className="text-xs text-[#64607D] mt-1.5 leading-relaxed">
                  Update your personal details, contact information, profile photo, and public profile URL.
                </p>
              </div>
            </div>
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#7C3AED]">
              <span>Edit Profile</span>
              <ArrowRight className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
            </div>
          </Link>

          <Link
            to="/dashboard/visibility"
            className="group bg-white border border-[#E9E4F5] hover:border-[#7C3AED] rounded-xl p-5 sm:p-6 shadow-[0_1px_2px_rgba(11,29,58,0.04)] transition-all duration-150 flex flex-col justify-between gap-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7C3AED]"
          >
            <div className="space-y-3">
              <div className="h-10 w-10 rounded-lg bg-[#7C3AED]/10 text-[#7C3AED] flex items-center justify-center">
                <Eye className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-display text-sm font-bold text-[#18142C]">Privacy &amp; Visibility</h3>
                <p className="text-xs text-[#64607D] mt-1.5 leading-relaxed">
                  Manage public profile visibility and choose which information visitors can see.
                </p>
              </div>
            </div>
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#7C3AED]">
              <span>Manage Visibility</span>
              <ArrowRight className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
            </div>
          </Link>

          <Link
            to="/dashboard/card-design"
            className="group bg-white border border-[#E9E4F5] hover:border-[#7C3AED] rounded-xl p-5 sm:p-6 shadow-[0_1px_2px_rgba(11,29,58,0.04)] transition-all duration-150 flex flex-col justify-between gap-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7C3AED]"
          >
            <div className="space-y-3">
              <div className="h-10 w-10 rounded-lg bg-[#7C3AED]/10 text-[#7C3AED] flex items-center justify-center">
                <CreditCard className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-display text-sm font-bold text-[#18142C]">Design Your Smart Card</h3>
                <p className="text-xs text-[#64607D] mt-1.5 leading-relaxed">
                  Customize your 85.6 × 54 mm smart card design and manage your card order.
                </p>
              </div>
            </div>
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#7C3AED]">
              <span>Design Smart Card</span>
              <ArrowRight className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
            </div>
          </Link>
        </div>
      </section>

      {/* Latest Order Quick Tracking Banner (Preserved) */}
      {latestOrder && (
        <div className="bg-white border border-[#E9E4F5] rounded-2xl p-5 sm:p-6 shadow-[0_1px_2px_rgba(11,29,58,0.04)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <span className="h-10 w-10 rounded-lg bg-[#F3EEFF] border border-[#E9E4F5] flex items-center justify-center text-[#7C3AED] shrink-0">
              <Package className="h-5 w-5" />
            </span>
            <div>
              <h3 className="font-display font-bold text-sm text-[#18142C]">
                Latest Order: <span className="font-mono">{latestOrder.orderNumber}</span>
              </h3>
              <p className="text-xs text-[#64607D] mt-1">
                Status: <strong className="text-[#18142C]">{latestOrder.orderStatus}</strong> · Payment:{' '}
                {latestOrder.paymentStatus} · Expected delivery: 10–15 days within India
              </p>
            </div>
          </div>
          <Link
            to={`/dashboard/orders/${latestOrder.orderId}`}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-[#18142C] hover:bg-[#2A2048] text-white text-xs font-semibold rounded-lg whitespace-nowrap transition-colors min-h-[40px]"
          >
            <span>Track Order</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
    </div>
  );
};
