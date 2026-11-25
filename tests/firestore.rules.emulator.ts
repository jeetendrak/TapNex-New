/**
 * Firebase Emulator Security Rules Verification Script ("Dirty Dozen" Payloads)
 *
 * Run against Firebase Local Emulator Suite:
 *   npm i -D @firebase/rules-unit-testing
 *   firebase emulators:exec "npx vitest run tests/firestore.rules.emulator.ts"
 */

export const DIRTY_DOZEN_SECURITY_CASES = [
  '1. Unauthenticated read on private users/{uid} must FAIL',
  '2. Unauthenticated read on publicProfiles/{slug} must SUCCEED (for NFC tap/QR scan)',
  '3. Unverified email user write on profiles/{profileId} must FAIL',
  '4. Cross-tenant user attempting to read or overwrite another user profile/order must FAIL',
  '5. Customer attempting self-privilege escalation (role: "ADMIN" or "SUPERADMIN") must FAIL',
  '6. Customer attempting to forge order with paymentStatus: "Verified" directly must FAIL',
  '7. Customer attempting to download raw qrCodes/{qrId} when allowCustomerQrView == false must FAIL',
  '8. Printer attempting to read unassigned order must FAIL',
  '9. Printer attempting to read auditLogs or payments must FAIL',
  '10. Customer attempting to mutate shippingTracking or delete immutable auditLogs must FAIL',
  '11. Blocked user attempting to create or update profile/order must FAIL',
  '12. Unauthenticated or non-Admin attempting to overwrite appSettings/global must FAIL',
];
