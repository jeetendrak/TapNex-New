# Security Specification & Red-Team Audit Plan

## 1. Data Invariants
1. **Role & Privilege Integrity**: Every newly created `users/{uid}` document MUST have `role == 'USER'`. Users cannot modify `role`, `status`, or `permissions` on their own user document. Only `SUPERADMIN` can create/modify `admins/{uid}` with `role == 'SUPERADMIN'`.
2. **Email Verification Enforcement**: Protected customer mutations (`profiles`, `cardDesigns`, `orders`, `supportTickets`) require `request.auth.token.email_verified == true`.
3. **PII Isolation**: Private contact fields (`personalInformation`, alternate email/mobile) live in `/profiles/{profileId}` restricted to owner/admin. Unauthenticated visitors can only read `/publicProfiles/{slug}` which contains exclusively customer-approved public fields.
4. **Pre-Payment QR & Print Secrecy**: `/qrCodes/{qrCodeId}` cannot be created or read by standard `USER` accounts before purchase; only `ADMIN`/`SUPERADMIN`, assigned `PRINTER`, or owner when explicitly enabled by `appSettings/global.allowCustomerQrView == true` can read a paid order's QR code.
5. **Payment & Order Integrity**: Clients cannot mark `paymentStatus == 'Verified'` or forge payment records without server-verified signature proof; `/payments/{paymentId}` updates and deletes are strictly forbidden to non-admins.
6. **Printer Isolation**: Users with `PRINTER` role can read and update ONLY orders where `resource.data.printerId == request.auth.uid`, and can only transition fulfilment fields (`orderStatus`, `courierName`, `trackingNumber`, `trackingUrl`, `dispatchDate`, `updatedAt`).
7. **Design Lock**: Once `cardDesigns/{designId}.locked == true`, the customer owner cannot overwrite the design; revisions require Admin/SuperAdmin intervention.
8. **Immutable Audit Trail**: `/auditLogs/{logId}` is append-only (`allow update, delete: if false;`) and readable only by `ADMIN`/`SUPERADMIN`.

## 2. The "Dirty Dozen" Attack Payloads
1. **Self-Promotion on Registration**: `POST /users/{uid}` with `{ role: "SUPERADMIN", status: "Active" }` -> `PERMISSION_DENIED`.
2. **Self-Role Escalation via Update**: `PATCH /users/{uid}` by owner updating `{ role: "ADMIN" }` -> `PERMISSION_DENIED`.
3. **Unverified Email Mutation**: `POST /profiles/{profileId}` with `email_verified: false` -> `PERMISSION_DENIED`.
4. **Shadow Ghost Field Injection**: `PATCH /profiles/{profileId}` with `{ isAdmin: true, slug: "test" }` -> `PERMISSION_DENIED`.
5. **Cross-User Private Profile Read**: `GET /profiles/{otherUserProfileId}` by unrelated user -> `PERMISSION_DENIED`.
6. **Pre-Purchase QR Creation by Customer**: `POST /qrCodes/{qrCodeId}` by `USER` -> `PERMISSION_DENIED`.
7. **Unauthorized Payment Tampering**: `PATCH /payments/{paymentId}` by `USER` setting `{ status: "Verified", signatureVerified: true }` -> `PERMISSION_DENIED`.
8. **Locked Card Design Overwrite**: `PATCH /cardDesigns/{designId}` by owner when `existing().locked == true` -> `PERMISSION_DENIED`.
9. **Printer Accessing Unassigned Order**: `GET /orders/{otherPrinterOrderId}` by `PRINTER` -> `PERMISSION_DENIED`.
10. **Printer Escalating Order Payment Status**: `PATCH /orders/{assignedOrderId}` by `PRINTER` changing `{ paymentStatus: "Refunded", total: 1 }` -> `PERMISSION_DENIED`.
11. **Resource Poisoning via Oversized ID**: `POST /profiles/{1500_char_id}` -> `PERMISSION_DENIED`.
12. **Audit Log Tampering**: `DELETE /auditLogs/{logId}` by `USER` or `ADMIN` -> `PERMISSION_DENIED`.
