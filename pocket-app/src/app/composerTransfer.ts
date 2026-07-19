/**
 * "Transfer to IBM Composer" — take-it-home handoff (docs/design.md,
 * "Take it home — run on real hardware", simplified 2026-07-19 to ONE button).
 *
 * ONE TAP: opens IBM Quantum Composer with the circuit PRE-LOADED via the
 * `?initial=` URL parameter, AND copies the QASM to the clipboard as a
 * belt-and-braces fallback.
 *
 * URL format (VERIFIED WORKING 2026-07-19, visually confirmed by Jan on the
 * live cloud Composer; rediscovered from the Qoffee-Maker family project,
 * qoffeefrontend/app.js): `?initial=` carries
 * encodeURIComponent(LZString.compressToEncodedURIComponent(JSON.stringify(
 * {title, description, qasm}))). Earlier bundle forensics wrongly concluded
 * the param was dead — a reminder that a negative grep proves nothing.
 * No credentials, no server round-trip — everything the visitor needs leaves
 * on their own device (design decision: NO in-app API-key entry).
 */
import LZString from 'lz-string';
import type { Circuit } from '@qamposer/react';

/** IBM Quantum Composer (cloud). */
export const COMPOSER_BASE = 'https://quantum.cloud.ibm.com/composer';

/** Toast shown when the Composer opened with the circuit + clipboard copy. */
export const COPIED_MESSAGE =
  'Composer opened with your circuit — sign in (free) to run it on a real quantum computer.';

/** Toast shown when copying failed: the pre-loaded tab still opened. */
export const NO_COPY_MESSAGE =
  'Composer opened with your circuit — sign in (free) to run it on real hardware.';

/**
 * Muted hint surfaced at the handoff UIs when the circuit uses all five wires
 * (see `usedQubits`): the Composer only SIMULATES up to four qubits for an
 * anonymous visitor, so a 5-qubit circuit opens fine but needs an IBM Quantum
 * sign-in to run/simulate there. Kept in one place so every surface says it the
 * same way.
 */
export const SIGN_IN_HINT =
  'Uses all 5 qubits — sign in to IBM Quantum to simulate it there (up to 4 without an account).';

/**
 * How many qubit wires a circuit's QASM actually uses: one past the highest
 * `q[i]` index any INSTRUCTION references (a CNOT's control AND target both
 * count). The register DECLARATIONS (`qreg q[N];` / `creg c[N];`) are ignored so
 * the current — always-5, board-shaped — declared width never inflates the
 * count. Trailing unused wires drop out; an empty circuit uses 1 (never 0).
 */
export function usedQubits(qasm: string): number {
  let max = -1;
  for (const line of qasm.split('\n')) {
    if (/^\s*(?:qreg|creg)\b/.test(line)) continue;
    for (const m of line.matchAll(/q\[(\d+)\]/g)) {
      const idx = Number(m[1]);
      if (idx > max) max = idx;
    }
  }
  return max < 0 ? 1 : max + 1;
}

/**
 * Rewrite the QASM's `qreg`/`creg` declarations to the actually-used qubit count
 * (see `usedQubits`), leaving every gate line — and its indices — untouched
 * (a gate on q4 keeps the size at 5; only trailing unused wires are trimmed).
 * This is what the Composer receives: the recognized board is always 5 wires,
 * but anonymous Composer simulation tops out at 4, so shipping the trimmed size
 * lets small circuits simulate without a sign-in. Pure and idempotent.
 */
export function withUsedQubits(qasm: string): string {
  const n = usedQubits(qasm);
  return qasm
    .replace(/^(\s*qreg\s+q\[)\d+(\];)/m, `$1${n}$2`)
    .replace(/^(\s*creg\s+c\[)\d+(\];)/m, `$1${n}$2`);
}

/**
 * The Composer URL with the circuit pre-loaded via `?initial=` (see the file
 * header for the verified format). The QASM is first trimmed to the qubits it
 * actually uses (`withUsedQubits`) so a small circuit can simulate on the anon
 * Composer. Falls back to the plain editor URL if the encoded payload would
 * exceed a conservative URL-length budget.
 */
export function composerUrl(qasm?: string, title = 'Built with Entangible'): string {
  if (!qasm) return COMPOSER_BASE;
  const payload = JSON.stringify({ title, description: '', qasm: withUsedQubits(qasm) });
  const component = encodeURIComponent(LZString.compressToEncodedURIComponent(payload));
  const url = `${COMPOSER_BASE}?initial=${component}`;
  return url.length > 7500 ? COMPOSER_BASE : url;
}

/** A circuit is transferable once it has at least one gate. */
export function canTransfer(circuit: Circuit): boolean {
  return circuit.gates.length > 0;
}

/** Injectable environment so the orchestration is testable without a real DOM. */
export interface TransferEnv {
  clipboard?: { writeText(text: string): Promise<void> } | undefined;
  /** Synchronous fallback copy (hidden textarea + execCommand). */
  execCopy?: ((text: string) => boolean) | undefined;
  open(url: string, target: string, features: string): unknown;
}

export interface TransferResult {
  readonly copied: boolean;
  readonly opened: boolean;
  readonly url: string;
  readonly message: string;
}

/** Default hidden-textarea + `execCommand('copy')` fallback (browser only). */
export function execCommandCopy(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const ta = document.createElement('textarea');
  ta.value = text;
  // Keep it out of view and out of the layout / scroll.
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '-9999px';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  try {
    ta.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(ta);
  }
}

function defaultEnv(): TransferEnv {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  return {
    clipboard: nav?.clipboard as TransferEnv['clipboard'],
    execCopy: execCommandCopy,
    open: (url, target, features) => window.open(url, target, features),
  };
}

async function tryCopy(text: string, env: TransferEnv): Promise<boolean> {
  if (env.clipboard?.writeText) {
    try {
      await env.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the execCommand fallback
    }
  }
  if (env.execCopy) {
    try {
      return env.execCopy(text);
    } catch {
      // ignore — reported as not-copied below
    }
  }
  return false;
}

/**
 * Copy the QASM (clipboard → hidden-textarea fallback) and open the Composer
 * in a new tab. Always opens the tab, even when both copy paths fail, and
 * adapts the returned toast message accordingly.
 */
export async function transferToComposer(
  qasm: string,
  env: TransferEnv = defaultEnv(),
): Promise<TransferResult> {
  // Copy the same trimmed QASM the Composer receives, so a paste fallback
  // matches what the ?initial= handoff opens.
  const copied = await tryCopy(withUsedQubits(qasm), env);
  const url = composerUrl(qasm);
  let opened = false;
  try {
    env.open(url, '_blank', 'noopener');
    opened = true;
  } catch {
    opened = false;
  }
  return {
    copied,
    opened,
    url,
    message: copied ? COPIED_MESSAGE : NO_COPY_MESSAGE,
  };
}
