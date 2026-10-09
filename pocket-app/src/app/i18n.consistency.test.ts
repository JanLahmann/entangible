/**
 * English copy that exists twice must say the same thing twice.
 *
 * A few English strings still live beside the data they describe — the
 * built-in menus, the test boards, the guide's section chips, the golf round
 * and hole names — because other code (and their own tests) read them there.
 * The messages (`shared/i18n/en.ts`) repeat them as the source the German is
 * keyed against; these checks keep the two copies from drifting, so English
 * renders exactly as authored and every translated key points at a real thing.
 */
import { describe, it, expect } from 'vitest';
import { en } from '@shared/i18n/en';
import { de } from '@shared/i18n/de';
import { BUILTIN_PACKS, localizePack } from '@shared/menu/builtinPacks';
import { HOLES, ROUND_LABEL } from '@quantum/golf';
import { TEST_BOARDS } from './testBoards';
import { GUIDE_SECTIONS } from './GuidePage';

describe('English messages match the data they translate', () => {
  it('leaves every built-in menu exactly as authored in English', () => {
    for (const pack of BUILTIN_PACKS) {
      expect(localizePack(pack, en), pack.id).toEqual(pack);
    }
  });

  it('keys every menu translation to a real built-in item', () => {
    for (const pack of BUILTIN_PACKS) {
      const keys = new Set(pack.items.map((i) => i.code ?? `q${i.qubit}`));
      const copy = en.quantina.packs[pack.id];
      expect(copy, pack.id).toBeDefined();
      for (const k of [...Object.keys(copy.items), ...Object.keys(copy.subtitles)]) {
        expect(keys.has(k), `${pack.id}.${k}`).toBe(true);
      }
    }
    expect(Object.keys(en.quantina.packs).sort()).toEqual(BUILTIN_PACKS.map((p) => p.id).sort());
  });

  it('localizes a built-in menu in German, and never a custom one', () => {
    const coffee = BUILTIN_PACKS.find((p) => p.id === 'coffee')!;
    const german = localizePack(coffee, de);
    expect(german.title).toBe(coffee.title); // a brand
    expect(german.items.find((i) => i.code === '000')?.name).toBe('Tee');
    // A pack that is not one of the bundled objects — even with a built-in id —
    // is shown as its author wrote it.
    const custom = { ...coffee, items: [...coffee.items] };
    expect(localizePack(custom, de)).toBe(custom);
  });

  it('repeats the test boards, the guide chips and the golf names verbatim', () => {
    expect(Object.keys(en.guide.testBoards)).toEqual(TEST_BOARDS.map((b) => b.id));
    for (const b of TEST_BOARDS) {
      expect(en.guide.testBoards[b.id]).toEqual({ title: b.title, blurb: b.blurb });
    }
    for (const s of GUIDE_SECTIONS) {
      expect(en.guide.sections[s.id]).toEqual({ nav: s.nav, title: s.title });
    }
    expect(en.golf.rounds).toEqual(ROUND_LABEL);
    const classicNames = new Set(HOLES.map((h) => h.name));
    for (const [name, english] of Object.entries(en.golf.holeNames)) {
      expect(classicNames.has(name), name).toBe(true);
      expect(english).toBe(name);
    }
  });
});
