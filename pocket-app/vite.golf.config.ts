/**
 * Golf-only bundle ("Quantum Golf", docs/golf-bundle.md): `npm run build:golf`
 * → pocket-app/dist-golf/, embedded offline by the Fun with Quantum iOS app.
 * The build choices are shared with the Runner bundle (vite-plugins/
 * appBundleConfig.ts); scripts/check-bundle.mjs --bundle golf verifies it.
 */
import { defineAppBundle } from './vite-plugins/appBundleConfig';

export default defineAppBundle({
  entryHtml: 'golf.html',
  outDir: 'dist-golf',
  product: 'Quantum Golf (Entangible golf bundle)',
});
