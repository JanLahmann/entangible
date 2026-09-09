#!/usr/bin/env node
// Refresh src/data/fwq-family.json from the shared Fun with Quantum manifest before a CI build.
//
// Runs as `prebuild`. Only acts in CI (GitHub Actions sets CI=true) so local builds never dirty
// the working tree; the committed copy stays the offline fallback and is kept fresh by an
// automated PR from JanLahmann/Fun-with-Quantum. Any failure keeps the committed copy — a build
// must never break because GitHub was slow.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const target = fileURLToPath(new URL('../src/data/fwq-family.json', import.meta.url));
const url = process.env.FWQ_FAMILY_URL
  ?? `https://raw.githubusercontent.com/JanLahmann/Fun-with-Quantum/master/family/family.json?t=${Date.now()}`;

if (!process.env.CI || process.env.FWQ_FAMILY_OFFLINE === '1') {
  console.log('[family] not in CI — keeping the committed fwq-family.json');
  process.exit(0);
}
try {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const json = JSON.parse(text);
  if (json.version !== 1 || !Array.isArray(json.members)) throw new Error('unexpected manifest shape');
  const current = readFileSync(target, 'utf8');
  if (current === text) console.log(`[family] manifest unchanged (updated ${json.updated})`);
  else { writeFileSync(target, text); console.log(`[family] manifest refreshed (updated ${json.updated})`); }
} catch (err) {
  console.warn(`[family] live manifest unavailable (${err.message}); using the committed copy`);
}
