import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import {
  CustomerOverviewDashboard,
  CustomerOverviewDashboardView,
  type CustomerOverviewDashboardProps,
} from '../src/components/CustomerOverviewDashboard';
import { DEFAULT_VISIBILITY, EMPTY_PERSONAL_INFO } from '../src/lib/constants';
import type { CardDesignRecord, OrderRecord, ProfileRecord } from '../src/types';

function collectElements(
  node: unknown,
  predicate: (el: { type?: unknown; props?: Record<string, unknown> }) => boolean,
  acc: Array<{ type?: unknown; props?: Record<string, unknown> }> = []
) {
  if (node == null || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') {
    return acc;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, predicate, acc);
    return acc;
  }
  if (typeof node === 'object') {
    const el = node as { type?: unknown; props?: Record<string, unknown> & { children?: unknown } };
    if (predicate(el)) acc.push(el);
    if (el.props && el.props.children !== undefined) {
      collectElements(el.props.children, predicate, acc);
    }
  }
  return acc;
}

const sampleProfiles: ProfileRecord[] = [
  {
    profileId: 'prof_adult_1',
    uid: 'user_1',
    profileType: 'adult',
    profileLabel: 'Personal / Business Profile',
    slug: 'adult-0dn63',
    selectedTemplate: 'azure-tech-waves',
    isPublic: true,
    adminApproved: false,
    paymentConfirmed: true,
    personalInformation: {
      ...EMPTY_PERSONAL_INFO,
      fullName: 'Jeetendra Kulkarni',
      email: 'user@tapnex.in',
      mobile: '9876543210',
    },
    socialLinks: [],
    customFields: [],
    visibilitySettings: DEFAULT_VISIBILITY,
    viewsCount: 42,
    createdAt: '2026-11-20T00:00:00.000Z',
    updatedAt: '2026-11-28T00:00:00.000Z',
  },
  {
    profileId: 'prof_pet_2',
    uid: 'user_1',
    profileType: 'pets',
    profileLabel: 'Pet Safety Tag',
    slug: 'pet-bruno',
    selectedTemplate: 'azure-tech-waves',
    isPublic: true,
    personalInformation: { ...EMPTY_PERSONAL_INFO, fullName: 'Bruno' },
    socialLinks: [],
    customFields: [],
    visibilitySettings: DEFAULT_VISIBILITY,
    viewsCount: 0,
    createdAt: '2026-11-21T00:00:00.000Z',
    updatedAt: '2026-11-21T00:00:00.000Z',
  },
  {
    profileId: 'prof_private_3',
    uid: 'user_1',
    profileType: 'belongings',
    profileLabel: 'Biker',
    slug: 'biker-tag',
    selectedTemplate: 'azure-tech-waves',
    isPublic: false,
    paymentConfirmed: true,
    personalInformation: { ...EMPTY_PERSONAL_INFO, fullName: 'Helmet Tag' },
    socialLinks: [],
    customFields: [],
    visibilitySettings: DEFAULT_VISIBILITY,
    viewsCount: 3,
    createdAt: '2026-11-22T00:00:00.000Z',
    updatedAt: '2026-11-22T00:00:00.000Z',
  },
];

const sampleOrder: OrderRecord = {
  orderId: 'ord_1',
  orderNumber: 'TNX-2026-86948',
  uid: 'user_1',
  profileId: 'prof_adult_1',
  profileSlug: 'adult-0dn63',
  designId: 'des_1',
  quantity: 1,
  total: 452,
  currency: 'INR',
  paymentStatus: 'Verified',
  orderStatus: 'Payment Successful',
  shippingAddress: {
    fullName: 'Jeetendra Kulkarni',
    mobile: '9876543210',
    email: 'user@tapnex.in',
    addressLine1: '10 MG Road',
    city: 'Pune',
    state: 'Maharashtra',
    pinCode: '411001',
    country: 'India',
  },
  createdAt: '2026-11-27T00:00:00.000Z',
  updatedAt: '2026-11-27T00:00:00.000Z',
};

const sampleDesign: CardDesignRecord = {
  designId: 'des_1',
  uid: 'user_1',
  profileId: 'prof_adult_1',
  templateId: 'azure-tech-waves',
  frontDesign: {
    backgroundColor: '#0B1D3A',
    logoX: 10,
    logoY: 10,
    logoWidthMm: 20,
    avatarX: 10,
    avatarY: 20,
    nfcIconColor: '#00D5F2',
    showNfcIcon: true,
    showQrSlot: false,
    qrSlotX: 0,
    qrSlotY: 0,
    qrSizeMm: 0,
    elements: [],
  },
  backDesign: {
    backgroundColor: '#0B1D3A',
    logoX: 10,
    logoY: 10,
    logoWidthMm: 20,
    avatarX: 10,
    avatarY: 20,
    nfcIconColor: '#00D5F2',
    showNfcIcon: false,
    showQrSlot: true,
    qrSlotX: 30,
    qrSlotY: 15,
    qrSizeMm: 24,
    elements: [],
  },
  cardOrientation: 'landscape',
  dimensions: '85.6x54mm',
  bleed: '3mm',
  approved: false,
  locked: false,
  version: 1,
  createdAt: '2026-11-27T00:00:00.000Z',
  updatedAt: '2026-11-27T00:00:00.000Z',
};

function makeProps(overrides: Partial<CustomerOverviewDashboardProps> = {}): CustomerOverviewDashboardProps {
  return {
    loading: false,
    profiles: sampleProfiles,
    activeProfile: sampleProfiles[0],
    orders: [sampleOrder],
    designs: [sampleDesign],
    activeDesign: sampleDesign,
    completion: 60,
    hasPaid: true,
    isDisabledByAdmin: false,
    publicUrl: 'https://tapnex.in/p/adult-0dn63',
    multipleProfilesEnabled: true,
    createProfileType: 'adult',
    deletingProfileId: null,
    onChangeCreateProfileType: vi.fn(),
    onOpenCreateModal: vi.fn(),
    onSelectProfile: vi.fn(),
    onOpenPreview: vi.fn(),
    onOpenCardPreview: vi.fn(),
    onEditProfile: vi.fn(),
    onControlVisibility: vi.fn(),
    onCopyUrl: vi.fn(),
    onDeleteProfile: vi.fn(),
    ...overrides,
  };
}

describe('CustomerOverviewDashboard SaaS UI', () => {
  it('renders all 4 summary cards, Your Digital Profiles management section, selected profile info, and Manage Your Profile quick actions', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CustomerOverviewDashboard {...makeProps()} />
      </MemoryRouter>
    );

    // 4 Summary Cards
    expect(html).toContain('Profile Completion');
    expect(html).toContain('60%');
    expect(html).toContain('Digital Profile Status');
    expect(html).toContain('Published &amp; Active');
    expect(html).toContain('/p/adult-0dn63');
    expect(html).toContain('Latest Card &amp; Order Status');
    expect(html).toContain('Payment Successful');
    expect(html).toContain('TNX-2026-86948');
    expect(html).toContain('Profile &amp; Smart Tap Visits');
    expect(html).toContain('42');

    // Digital Profiles Header & Count Badge
    expect(html).toContain('Your Digital Profiles');
    expect(html).toContain('3 profiles');
    expect(html).toContain('Create New Profile');

    // Profile Cards & Statuses (without internal profileId leaked)
    expect(html).toContain('Personal / Business Profile');
    expect(html).toContain('Pet Safety Tag');
    expect(html).toContain('Unpaid Preview');
    expect(html).toContain('Biker');
    expect(html).toContain('Unpublished');
    expect(html).toContain('Active');
    expect(html).not.toContain('prof_adult_1');
    expect(html).not.toContain('prof_pet_2');

    // Selected Profile Action Toolbar & Information
    expect(html).toContain('Preview Profile');
    expect(html).toContain('Preview Card Design');
    expect(html).toContain('Control Public Visibility');
    expect(html).toContain('Copy Profile URL');
    expect(html).toContain('Delete Profile');
    expect(html).toContain('Publication Status');
    expect(html).toContain('Visibility Status');

    // Manage Your Profile Quick Actions & Routes
    expect(html).toContain('Manage Your Profile');
    expect(html).toContain('href="/dashboard/profile"');
    expect(html).toContain('href="/dashboard/visibility"');
    expect(html).toContain('href="/dashboard/card-design"');
    expect(html).toContain('Manage Visibility');
    expect(html).toContain('Design Smart Card');
    expect(html).toContain('href="/dashboard/orders/ord_1"');
  });

  it('invokes existing profile selection, creation, preview, edit, visibility, copy, and delete handlers', async () => {
    const props = makeProps();
    const onToggleMobileMenu = vi.fn();
    const onCloseMobileMenu = vi.fn();
    const onHandleCopy = vi.fn(async () => {
      await props.onCopyUrl(props.publicUrl);
    });

    const tree = CustomerOverviewDashboardView({
      ...props,
      copiedKey: null,
      mobileMenuOpen: false,
      onToggleMobileMenu,
      onCloseMobileMenu,
      onHandleCopy,
    });

    // Click second profile card
    const profileCards = collectElements(
      tree,
      (el) => el.type === 'button' && el.props?.['aria-pressed'] !== undefined
    );
    expect(profileCards).toHaveLength(3);
    expect(profileCards[0].props?.['aria-pressed']).toBe(true);
    expect(profileCards[1].props?.['aria-pressed']).toBe(false);
    (profileCards[1].props?.onClick as () => void)();
    expect(props.onSelectProfile).toHaveBeenCalledWith('prof_pet_2');

    // Click Create New Profile
    const createButtons = collectElements(
      tree,
      (el) =>
        el.type === 'button' &&
        JSON.stringify(el.props?.children || '').includes('Create New Profile')
    );
    expect(createButtons.length).toBeGreaterThanOrEqual(1);
    (createButtons[0].props?.onClick as () => void)();
    expect(props.onOpenCreateModal).toHaveBeenCalledTimes(1);

    // Click Edit Profile, Preview Profile, Preview Card Design, Control Public Visibility
    const editButtons = collectElements(
      tree,
      (el) =>
        el.type === 'button' &&
        JSON.stringify(el.props?.children || '').includes('Edit Profile')
    );
    expect(editButtons.length).toBeGreaterThanOrEqual(1);
    (editButtons[0].props?.onClick as () => void)();
    expect(props.onEditProfile).toHaveBeenCalledTimes(1);

    const previewButtons = collectElements(
      tree,
      (el) =>
        el.type === 'button' &&
        JSON.stringify(el.props?.children || '').includes('Preview Profile')
    );
    expect(previewButtons.length).toBeGreaterThanOrEqual(1);
    (previewButtons[0].props?.onClick as () => void)();
    expect(props.onOpenPreview).toHaveBeenCalledTimes(1);

    const cardPreviewButtons = collectElements(
      tree,
      (el) =>
        el.type === 'button' &&
        JSON.stringify(el.props?.children || '').includes('Preview Card Design')
    );
    expect(cardPreviewButtons.length).toBeGreaterThanOrEqual(1);
    (cardPreviewButtons[0].props?.onClick as () => void)();
    expect(props.onOpenCardPreview).toHaveBeenCalledTimes(1);

    const visibilityButtons = collectElements(
      tree,
      (el) =>
        el.type === 'button' &&
        JSON.stringify(el.props?.children || '').includes('Control Public Visibility')
    );
    expect(visibilityButtons.length).toBeGreaterThanOrEqual(1);
    (visibilityButtons[0].props?.onClick as () => void)();
    expect(props.onControlVisibility).toHaveBeenCalledTimes(1);

    // Click Delete Profile
    const deleteButtons = collectElements(
      tree,
      (el) =>
        el.type === 'button' &&
        JSON.stringify(el.props?.children || '').includes('Delete Profile')
    );
    expect(deleteButtons.length).toBeGreaterThanOrEqual(1);
    await (deleteButtons[0].props?.onClick as () => Promise<void>)();
    expect(props.onDeleteProfile).toHaveBeenCalledWith(sampleProfiles[0]);

    // Click Copy Profile URL (inline summary copy icon)
    const copySummaryBtn = collectElements(
      tree,
      (el) => el.type === 'button' && el.props?.['aria-label'] === 'Copy public URL'
    );
    expect(copySummaryBtn).toHaveLength(1);
    await (copySummaryBtn[0].props?.onClick as () => Promise<void>)();
    expect(onHandleCopy).toHaveBeenCalledWith('summary');
    expect(props.onCopyUrl).toHaveBeenCalledWith('https://tapnex.in/p/adult-0dn63');
  });

  it('renders loading skeleton, unpaid watermarked state, and empty profiles state cleanly', () => {
    const loadingHtml = renderToStaticMarkup(
      <MemoryRouter>
        <CustomerOverviewDashboard {...makeProps({ loading: true })} />
      </MemoryRouter>
    );
    expect(loadingHtml).toContain('aria-busy="true"');

    const unpaidHtml = renderToStaticMarkup(
      <MemoryRouter>
        <CustomerOverviewDashboard
          {...makeProps({
            activeProfile: sampleProfiles[1],
            hasPaid: false,
            publicUrl: '',
            activeDesign: null,
          })}
        />
      </MemoryRouter>
    );
    expect(unpaidHtml).toContain('Payment Pending (Locked)');
    expect(unpaidHtml).toContain('View Watermarked Preview');

    const emptyHtml = renderToStaticMarkup(
      <MemoryRouter>
        <CustomerOverviewDashboard
          {...makeProps({ profiles: [], activeProfile: null, orders: [], designs: [], activeDesign: null })}
        />
      </MemoryRouter>
    );
    expect(emptyHtml).toContain('No digital profiles created yet');
    expect(emptyHtml).toContain('Create First Profile');
  });
});
