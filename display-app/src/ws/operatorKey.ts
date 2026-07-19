/**
 * Display-app re-export of the shared operator-key helper.
 *
 * The staff-credential handling moved to `shared/ws` (U2) so the pocket app's
 * CAMERA role can reuse it (a staff QR opens `/pocket?…&key=…` pre-authorized).
 * This shim keeps every existing `../ws/operatorKey` import in the display app
 * working; the canonical source lives in `@shared/ws/operatorKey`.
 */
export * from '@shared/ws/operatorKey';
