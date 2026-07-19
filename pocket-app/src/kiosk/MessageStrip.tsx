/**
 * MessageStrip — kiosk binding of the shared MessageStrip (SC2). Ported from the
 * former display-app booth surface (Entangible One, phase U3).
 *
 * The queue-drop + min-dwell + cross-fade logic lives in
 * `@shared/display/MessageStrip`; this binds the kiosk's `ent-` class scheme
 * (`ent-strip` / `ent-strip__text`, 32 px @1080p, docs/booth-ux.md). Re-exports
 * the type + timing constants so existing kiosk imports are unchanged.
 */
import {
  MessageStrip as SharedMessageStrip,
  type StripMessage,
} from '@shared/display/MessageStrip';

export { MIN_DWELL_MS, FADE_MS } from '@shared/display/MessageStrip';
export type { StripMessage };

export function MessageStrip({ message }: { message: StripMessage | null }) {
  return <SharedMessageStrip message={message} classPrefix="ent" />;
}

export default MessageStrip;
