/**
 * Runner-only bundle ("Quantum Runner", docs/runner-bundle.md):
 * `npm run build:runner` → pocket-app/dist-runner/, embedded offline by the
 * Fun with Quantum iOS app. The build choices are shared with the golf bundle
 * (vite-plugins/appBundleConfig.ts); scripts/check-bundle.mjs --bundle runner
 * verifies it.
 */
import { defineAppBundle } from './vite-plugins/appBundleConfig';

export default defineAppBundle({
  entryHtml: 'runner.html',
  outDir: 'dist-runner',
  product: 'Quantum Runner (Entangible runner bundle)',
});
