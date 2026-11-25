export type UserRole = 'USER' | 'PRINTER' | 'ADMIN' | 'SUPERADMIN';
export type UserStatus = 'Pending Verification' | 'Active' | 'Blocked' | 'Disabled';

export type OrderStatus =
  | 'Design Pending'
  | 'Design Approved'
  | 'Awaiting Payment'
  | 'Payment Successful'
  | 'Processing'
  | 'Assigned to Printer'
  | 'Printing in Progress'
  | 'Quality Check'
  | 'Ready for Dispatch'
  | 'Dispatched'
  | 'In Transit'
  | 'Delivered'
  | 'Cancelled'
  | 'Refunded';

export type PaymentStatus = 'Pending' | 'Completed' | 'Verified' | 'Rejected' | 'Failed' | 'Refunded';

export type AdminPermission =
  | 'manage_users'
  | 'manage_printers'
  | 'manage_orders'
  | 'manage_payments'
  | 'manage_templates'
  | 'manage_qr'
  | 'manage_shipping'
  | 'manage_support'
  | 'view_reports'
  | 'manage_settings';

export interface UserRecord {
  uid: string;
  username?: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  phone?: string;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
  mustChangePassword?: boolean;
  permissions?: AdminPermission[];
  createdAt: unknown;
  updatedAt: unknown;
  lastLoginAt?: unknown;
}

export interface AdminRegistry {
  uid: string;
  email: string;
  role: 'ADMIN' | 'SUPERADMIN';
  permissions?: AdminPermission[];
  active: boolean;
  updatedAt: unknown;
}

export interface PrinterRecord {
  printerId: string;
  uid: string;
  businessName: string;
  contactPerson: string;
  phone?: string;
  email: string;
  address?: string;
  status: 'Active' | 'Blocked' | 'Disabled';
  serviceAreas?: string[];
  createdAt: unknown;
  updatedAt?: unknown;
}

export type SocialPlatformId =
  | 'whatsapp'
  | 'instagram'
  | 'facebook'
  | 'linkedin'
  | 'twitter'
  | 'youtube'
  | 'telegram'
  | 'pinterest'
  | 'snapchat'
  | 'threads'
  | 'github'
  | 'behance'
  | 'dribbble'
  | 'website'
  | 'google_business'
  | 'custom';

export interface SocialLinkItem {
  id: string;
  platform: SocialPlatformId;
  label: string;
  url: string;
  enabled: boolean;
  order: number;
}

export type CustomFieldType = 'text' | 'phone' | 'email' | 'url' | 'address' | 'date';

export interface CustomFieldItem {
  id: string;
  label: string;
  value: string;
  type: CustomFieldType;
  order: number;
  visible: boolean;
}

export type ProfileType = 'adult' | 'kids' | 'pets' | 'belongings';

export interface PersonalInformation {
  photoDataUrl?: string;
  fullName: string;
  jobTitle: string;
  companyName: string;
  businessCategory: string;
  shortBio: string;
  mobile: string;
  alternateMobile: string;
  whatsapp: string;
  email: string;
  alternateEmail: string;
  website: string;
  businessAddress: string;
  personalAddress?: string;
  city: string;
  state: string;
  pinCode: string;
  country: string;
  // Adult Emergency & ID
  emergencyContactName?: string;
  emergencyContactRelation?: string;
  emergencyContactPhone?: string;
  bloodGroup?: string;
  aadhaarNumber?: string;
  panNumber?: string;
  // Kids Fields
  dateOfBirth?: string;
  age?: string;
  parentName?: string;
  parentMobile?: string;
  schoolOrClass?: string;
  allergiesOrMedical?: string;
  specialNotes?: string;
  // Pets Fields
  petType?: string;
  breed?: string;
  petGender?: string;
  petColor?: string;
  microchipId?: string;
  ownerName?: string;
  ownerMobile?: string;
  vetName?: string;
  vetPhone?: string;
  // Personal Belongings Fields
  itemCategory?: string;
  itemCategoryOther?: string;
  brandModel?: string;
  serialNumber?: string;
  finderNotes?: string;
}

export interface VisibilitySettings {
  photo: boolean;
  fullName: boolean;
  jobTitle: boolean;
  companyName: boolean;
  businessCategory: boolean;
  shortBio: boolean;
  mobile: boolean;
  alternateMobile: boolean;
  whatsapp: boolean;
  email: boolean;
  alternateEmail: boolean;
  website: boolean;
  businessAddress: boolean;
  personalAddress?: boolean;
  emergencyContact?: boolean;
  bloodGroup?: boolean;
  aadhaarNumber?: boolean;
  panNumber?: boolean;
  dateOfBirth?: boolean;
  parentContact?: boolean;
  schoolOrClass?: boolean;
  medicalInfo?: boolean;
  specialNotes?: boolean;
  petDetails?: boolean;
  ownerContact?: boolean;
  vetContact?: boolean;
  itemDetails?: boolean;
  finderNotes?: boolean;
  socialLinks: Record<string, boolean>;
}

export interface ProfileRecord {
  profileId: string;
  uid: string;
  profileLabel?: string;
  profileType?: ProfileType;
  slug: string;
  personalInformation: PersonalInformation;
  socialLinks: SocialLinkItem[];
  customFields: CustomFieldItem[];
  visibilitySettings: VisibilitySettings;
  selectedTemplate: string;
  isPublic: boolean;
  paymentConfirmed?: boolean;
  paymentCompletedAt?: string;
  paymentReference?: string;
  adminApproved?: boolean;
  adminApprovedAt?: string;
  adminApprovedBy?: string;
  adminDisabled?: boolean;
  viewsCount?: number;
  qrScansCount?: number;
  nfcVisitsCount?: number;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface PublicProfileRecord {
  slug: string;
  profileId: string;
  uid: string;
  profileType?: ProfileType;
  isPublic: boolean;
  unavailableMessage?: string;
  personalInformation?: Partial<PersonalInformation>;
  socialLinks?: SocialLinkItem[];
  customFields?: CustomFieldItem[];
  themeColor?: string;
  paymentConfirmed?: boolean;
  paymentCompletedAt?: string;
  adminApproved?: boolean;
  adminApprovedAt?: string;
  adminApprovedBy?: string;
  adminDisabled?: boolean;
  lastPaidOrderId?: string;
  updatedAt: unknown;
}

export interface CardTextElement {
  id: string;
  text: string;
  fieldKey?: string; // Tracks linked My Profile field key even when text is pre-filled or customized
  fieldKeys?: string[]; // Tracks multiple linked field keys when a template line combines tokens
  sourceTokenText?: string; // Original template token expression so unedited fields re-sync when profile changes
  lastSyncedText?: string; // Snapshot of last auto-resolved value to detect manual edits cleanly
  xPct: number; // 0..100 inside trim box
  yPct: number; // 0..100 inside trim box
  maxWidthPct?: number; // 15..95 wrapping width %
  fontSizePt: number;
  fontFamily: string;
  fontWeight: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  textDecoration?: 'none' | 'underline';
  uppercase?: boolean;
  letterSpacingPx?: number;
  curveDeg?: number; // -90..90; >0 arches upward (top), <0 arches downward (bottom)
  color: string;
  align: 'left' | 'center' | 'right';
}

export interface CardShapeElement {
  id: string;
  kind: 'rect' | 'circle' | 'line' | 'pill' | 'star';
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  color: string;
  gradientTo?: string;
  borderRadiusPx?: number;
  borderColor?: string;
  borderWidthPx?: number;
  opacity?: number;
  rotationDeg?: number;
}

export interface MediaClipCircleSpec {
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  borderColor?: string;
  borderWidthPx?: number;
}

export interface CardSideDesign {
  backgroundColor: string;
  gradientTo?: string;
  backgroundImageUrl?: string;
  showBorder?: boolean;
  borderColor?: string;
  borderWidthPx?: number;
  logoDataUrl?: string;
  logoX: number;
  logoY: number;
  logoWidthMm: number;
  avatarDataUrl?: string;
  showAvatar?: boolean;
  avatarShape?: 'circle' | 'rounded' | 'square';
  showAvatarBorder?: boolean;
  avatarBorderColor?: string;
  avatarX: number;
  avatarY: number;
  avatarSizeMm?: number;
  mediaClipCircle?: MediaClipCircleSpec;
  showNfcIcon: boolean;
  nfcIconColor: string;
  nfcX?: number;
  nfcY?: number;
  nfcSizeMm?: number;
  showQrSlot: boolean;
  qrSlotX: number; // percentage 0..100
  qrSlotY: number; // percentage 0..100
  qrSizeMm: number;
  shapes?: CardShapeElement[];
  elements: CardTextElement[];
}

export type CardDesignTier = 'minimal' | 'designer';
export type CardTechnologyType = 'qr_only' | 'qr_smart';

export interface CardTemplateRecord {
  templateId: string;
  name: string;
  category?: string;
  profileType?: ProfileType | 'all';
  designTier?: CardDesignTier;
  pricingMode?: 'card_tiers' | 'fixed_pack';
  packNote?: string;
  tagKeywords?: string[];
  description?: string;
  priceInr: number;
  cardType?: string;
  active: boolean;
  isDefault?: boolean;
  supportsVertical?: boolean;
  frontSpec: CardSideDesign;
  backSpec: CardSideDesign;
  updatedAt?: unknown;
}

export interface CardDesignRecord {
  designId: string;
  uid: string;
  profileId: string;
  orderId?: string;
  templateId: string;
  cardTechnology?: CardTechnologyType;
  frontDesign: CardSideDesign;
  backDesign: CardSideDesign;
  cardOrientation: 'landscape' | 'vertical';
  dimensions: '85.6x54mm' | '54x85.6mm';
  bleed: '3mm';
  approved: boolean;
  locked: boolean;
  approvedAt?: unknown;
  version: number;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface ShopCategoryRecord {
  categoryId: string;
  name: string;
  slug: string;
  description?: string;
  sortOrder: number;
  active: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ShopProductRecord {
  productId: string;
  name: string;
  slug?: string;
  categoryId: string;
  categoryName?: string;
  shortDescription?: string;
  description: string;
  features: string[];
  priceInr: number;
  compareAtPriceInr?: number;
  cardType?: string;
  imageDataUrl: string;
  badgeText?: string;
  visibleOnShop: boolean;
  featured?: boolean;
  inStock: boolean;
  sortOrder: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ShopCartItem {
  product: ShopProductRecord;
  quantity: number;
}

export interface OrderShopItem {
  productId: string;
  name: string;
  categoryName?: string;
  cardType?: string;
  quantity: number;
  priceInr: number;
  lineTotal?: number;
}

export interface ShippingAddress {
  fullName: string;
  mobile: string;
  email: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  pinCode: string;
  country: string;
}

export interface OrderRecord {
  orderId: string;
  orderNumber: string;
  uid: string;
  profileId: string;
  profileSlug?: string;
  designId: string;
  orderSource?: 'studio' | 'shop';
  shopItems?: OrderShopItem[];
  printerId?: string;
  quantity: number;
  cardType?: string;
  subtotal?: number;
  tax?: number;
  shipping?: number;
  total: number;
  currency: 'INR';
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  shippingAddress: ShippingAddress;
  qrCodeId?: string;
  printFileReady?: boolean;
  courierName?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  dispatchDate?: string;
  internalNotes?: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export type PaymentGatewayId =
  | 'razorpay'
  | 'cashfree'
  | 'easebuzz'
  | 'payu'
  | 'gpay'
  | 'upi';

export interface PaymentGatewayConfig {
  id: PaymentGatewayId;
  label: string;
  enabled: boolean;
  mode: 'sandbox' | 'live';
  publicKeyId?: string;
  merchantId?: string;
  upiId?: string;
  upiPayeeName?: string;
  description?: string;
}

export type PaymentGatewayTransactionMode =
  | 'razorpay_live'
  | 'razorpay_sandbox'
  | 'cashfree_live'
  | 'cashfree_sandbox'
  | 'easebuzz_live'
  | 'easebuzz_sandbox'
  | 'payu_live'
  | 'payu_sandbox'
  | 'gpay_live'
  | 'gpay_sandbox'
  | 'upi_live'
  | 'upi_sandbox';

export interface PaymentRecord {
  paymentId: string;
  orderId: string;
  uid: string;
  gateway: PaymentGatewayTransactionMode;
  gatewayOrderId: string;
  gatewayPaymentId?: string;
  signatureVerified: boolean;
  amount: number;
  currency: 'INR';
  status: 'Created' | 'Pending' | 'Completed' | 'Verified' | 'Rejected' | 'Failed' | 'Refunded';
  verifiedAt?: unknown;
  createdAt: unknown;
}

export interface QrCodeRecord {
  qrCodeId: string;
  uid?: string;
  orderId?: string;
  printerId?: string;
  targetUrl: string;
  svgContent: string;
  pngDataUrl?: string;
  storagePath?: string;
  format: 'PNG_SVG';
  qrType: 'CUSTOMER_ORDER' | 'ADMIN_CUSTOM';
  customerName?: string;
  description?: string;
  version: number;
  createdBy: string;
  createdAt: unknown;
}

export interface ShippingRecord {
  shippingId: string;
  orderId: string;
  uid: string;
  printerId: string;
  courierName: string;
  trackingNumber: string;
  trackingUrl?: string;
  dispatchDate: string;
  notes?: string;
  createdAt: unknown;
}

export interface SupportTicketRecord {
  ticketId: string;
  uid: string;
  orderId?: string;
  subject: string;
  message: string;
  category: 'Order' | 'Design Revision' | 'SMART Help' | 'NFC Help' | 'Billing' | 'General';
  status: 'Open' | 'In Progress' | 'Resolved' | 'Closed';
  adminReply?: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface EmailTemplateRecord {
  templateId: string;
  name: string;
  subject: string;
  htmlBody: string;
  updatedAt: unknown;
}

export interface NotificationRecord {
  notificationId: string;
  uid: string;
  title: string;
  message: string;
  channel: 'in_app' | 'email';
  deliveryStatus: 'Queued' | 'Sent' | 'ConfigRequired' | 'Read';
  createdAt: unknown;
}

export interface AppSettingsRecord {
  settingId: string;
  companyName: string;
  supportEmail: string;
  multipleProfilesEnabled: boolean;
  allowCustomerQrView: boolean;
  baseCardPriceInr: number;
  taxRatePercent: number;
  shippingFeeInr: number;
  inactiveProfileMessage: string;
  paymentGateways?: Record<PaymentGatewayId, PaymentGatewayConfig>;
  updatedAt: unknown;
}

export interface AuditLogRecord {
  logId: string;
  actorUid: string;
  actorEmail?: string;
  actorRole: UserRole | 'SYSTEM';
  action: string;
  targetCollection: string;
  targetId: string;
  details?: string;
  createdAt: unknown;
}
