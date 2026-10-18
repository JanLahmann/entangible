#!/usr/bin/env node
/**
 * Kept for old command lines: the golf bundle's guard is now
 * `node scripts/check-bundle.mjs --bundle golf [dist-golf]` (shared with the
 * Runner bundle — docs/golf-bundle.md, docs/runner-bundle.md).
 */
import { main } from './check-bundle.mjs';

main(['--bundle', 'golf', ...process.argv.slice(2)]);
