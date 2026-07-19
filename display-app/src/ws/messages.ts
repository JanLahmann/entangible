/**
 * Display-app re-export of the neutral wire-protocol types.
 *
 * The protocol module moved to `shared/ws` (U1) so the pocket app's
 * `BoothSocketSource` and the display app share exactly one schema. This shim
 * keeps every existing `../ws/messages` import in the display app working; the
 * canonical source (and the `docs/protocol.md` parity test) lives in
 * `@shared/ws/messages`.
 */
export * from '@shared/ws/messages';
