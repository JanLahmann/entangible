/**
 * Quantum Golf, the game driver — one hook for every surface that plays the
 * course on a pocket-style screen: the site shell (`App`, camera / booth /
 * build-on-screen) and the golf-only bundle (`src/golf/GolfApp`, embedded
 * offline by the Fun with Quantum iOS app — docs/golf-bundle.md).
 *
 * The rules live in the pure engine (`@quantum/golf`, `@quantum/golfRandom`);
 * this hook owns what used to be woven through `App`: the golf state and its
 * synchronous ref, the course dealer, the per-device bests / reveals in
 * storage, the course-code + scope settings, celebrations and the course-end
 * guard. Anything surface-specific comes in as an option, so the hook pulls
 * in no camera, booth, analytics or settings-store code of its own:
 *
 *   - `courseCode` / `courseScope` + their writers — the site persists them in
 *     its settings store (and `?course=` lands there); the golf bundle keeps
 *     its own small store.
 *   - `clearBoard` — present only while the on-screen editor is the input
 *     (build-on-screen). It is what "Next hole", "Play again", a wipe and a
 *     course switch use to empty the board; without it (camera / booth) those
 *     on-screen affordances do not exist and physically clearing the table is
 *     the ritual, exactly as before the extraction.
 *   - `onCelebrate` / `onEvent` — the caller stamps the celebration token and
 *     decides whether anything is reported anywhere (the bundle reports
 *     nothing).
 *
 * `step(circuit)` is the golf branch of the site's `applyUpdate`: call it with
 * every new circuit while golf is the mode. It is identity-stable, so a source
 * subscription keyed on it is never torn down by a re-render.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Circuit } from '@qamposer/react';
import { courseElapsed, tickCourseTimer } from '@shared/display/courseTimer';
import { useT } from '@shared/i18n';
import type { CelebrationRequest } from '@shared/display/Celebrations';
import {
  golfStep,
  completionCelebration,
  courseTotals,
  initialGolfState,
  scoreName,
  loadBest,
  saveBest,
  loadRevealed,
  saveRevealed,
  golfReveal,
  golfWipe,
  golfJumpTo,
  persistsBest,
  parseScope,
  scopeCode,
  scopeHoles,
  type GolfCourse,
  type GolfScope,
  type GolfState,
  type Hole,
} from '@quantum/golf';
import {
  courseCode as toCourseCode,
  courseHoles,
  isCourseReady,
  parseCourseCode,
  randomBaseSeed,
} from '@quantum/golfRandom';
import { useCourseDealer, type Dealing } from './CourseDealing';

/** Where bests and paid-for reveals are remembered (localStorage in the apps). */
export type GolfStorage = Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>;

/** A celebration minus its token — the caller stamps that (shared counter). */
export type GolfCelebration = Omit<CelebrationRequest, 'token'>;

/** The two game events the site reports (analytics.ts `GameEvent`). */
export type GolfEvent = 'golf hole finished' | 'golf round finished';

export interface GolfGameOptions {
  /** Bests + reveals store; null = remember nothing (tests, SSR). */
  readonly storage: GolfStorage | null;
  /** The persisted random-course code (base 36), or null for the classic course. */
  readonly courseCode: string | null;
  /** The persisted competition scope code (`E`/`M`/`D`/`X`), or null = full. */
  readonly courseScope: string | null;
  /** Persist the code of the course now in play (null = classic). */
  readonly setCourseCode: (code: string | null) => void;
  /** Persist the competition scope (null = full course). */
  readonly setCourseScope: (scope: string | null) => void;
  /** Build-on-screen only: empty the on-screen board. */
  readonly clearBoard?: () => void;
  /** The live circuit (wipe and hole-jump read it). */
  readonly circuit: Circuit;
  readonly onCelebrate: (celebration: GolfCelebration) => void;
  readonly onEvent?: (what: GolfEvent, data: Record<string, string | number | undefined>) => void;
}

export interface GolfGame {
  readonly state: GolfState;
  /** The course in play: the fixed 18, or this session's generated ones. */
  readonly holes: readonly Hole[];
  readonly currentLevel: Hole;
  /** The course being dealt right now (drives `CourseDealing`), or null. */
  readonly dealing: Dealing | null;
  /** Feed one new circuit through the engine (stable identity). */
  readonly step: (next: Circuit) => void;
  /** Switch course: always a full re-tee; `random` always deals a fresh seed. */
  readonly pickCourse: (course: GolfCourse) => void;
  /** Pick what the competition is over: a full re-tee of the same course. */
  readonly pickScope: (scope: GolfScope) => void;
  /** Next hole / play again — build-on-screen only (undefined otherwise). */
  readonly advanceHole: (() => void) | undefined;
  /** Take the mid-hole reveal's price (#99). */
  readonly takeReveal: (holeNumber: number) => void;
  /** Wipe the board for one flat stroke (#100) — build-on-screen only. */
  readonly wipeBoard: (() => void) | undefined;
  /** Tap a chip, play that hole (#101). */
  readonly jumpToHole: (holeNumber: number) => void;
}

export function useGolfGame(options: GolfGameOptions): GolfGame {
  const { storage, circuit, clearBoard } = options;
  const t = useT();
  // Callbacks and effects read the latest options/messages through a ref, so
  // `step` keeps one identity for the life of the component.
  const optsRef = useRef(options);
  optsRef.current = options;
  const tRef = useRef(t);
  tRef.current = t;

  // Every move onto a random course goes through the dealer: a course that is
  // not dealt yet is generated off the critical path (behind the "Dealing
  // course" indicator) and only then put in play, because render reads the
  // course synchronously and a cold deal is seconds of work.
  const { dealing, deal: dealCourse, cancel: cancelDeal, pendingSeed: pendingDeal } =
    useCourseDealer();
  // A shared course code (#78) — from `?course=`, the settings drawer, or a
  // previous session — opens golf straight onto that generated course. The code
  // IS the seed, so the eighteen holes are the ones the sender played.
  const [state, setState] = useState<GolfState>(() => {
    const seed = options.courseCode === null ? null : parseCourseCode(options.courseCode);
    // A shared link carries the competition scope beside the course (#102);
    // one without a scope is a full round, as every pre-#102 link was.
    const scope = parseScope(options.courseScope);
    // A code whose course is not dealt yet (on a fresh page load: always) opens
    // on the classic card for the moment; the course-code effect below sees the
    // code and deals it, then moves onto it.
    return seed === null || !isCourseReady(seed)
      ? initialGolfState(loadBest(storage), 'classic', 0, loadRevealed(storage), scope)
      : initialGolfState({}, 'random', seed, {}, scope);
  });
  const stateRef = useRef<GolfState>(state);
  /** One course-end celebration per completion (#80); cleared on restart. */
  const completedRef = useRef(false);

  const put = useCallback((next: GolfState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  /** Tee off a brand-new random course on `seed` (once it is dealt). */
  const dealFresh = useCallback(
    (seed: number, after?: () => void) => {
      dealCourse(seed, () => {
        put(initialGolfState({}, 'random', seed, {}, stateRef.current.scope));
        after?.();
      });
    },
    [dealCourse, put],
  );

  const step = useCallback(
    (next: Circuit) => {
      // While a course is being dealt the board does not play: the state in
      // hand belongs to the course being left, and the new one tees off from
      // a fresh baseline once it is dealt.
      if (pendingDeal() !== null) return;
      const store = optsRef.current.storage;
      const prev = stateRef.current;
      const result = golfStep(prev, next, courseHoles(prev));
      const nextState = result.state;
      put(nextState);
      // Finishing a RANDOM course and clearing the board deals a NEW course:
      // "play again" on a generated round means a fresh 18, not the same 18.
      if (result.restarted && prev.course === 'random') dealFresh(randomBaseSeed());
      // A board-clear restart tees off a new round, so the mid-hole reveals
      // it may have paid for go with the old one (#99).
      if (result.restarted && persistsBest(nextState)) saveRevealed(store, nextState.revealed);
      // Course finished (#80): one burst, scaled and worded by the round.
      // Guarded by a ref like the moment engine's dedupe, so a replayed frame
      // or a StrictMode double-invoke cannot fire it twice; the guard clears
      // on restart, so playing again can earn it again.
      if (result.justCompleted && !completedRef.current) {
        completedRef.current = true;
        optsRef.current.onEvent?.('golf round finished', {
          course: result.state.course,
          scope: String(result.state.scope),
        });
        const timing = tickCourseTimer(result.state, Date.now());
        // Scored against the SCOPE's par (#102): finishing the easy round is
        // measured against 25, not against the full course's 101.
        const done = completionCelebration(
          courseTotals(result.state.best, scopeHoles(courseHoles(result.state), result.state.scope))
            .vsPar,
          courseElapsed(timing, Date.now()),
          tRef.current,
        );
        optsRef.current.onCelebrate({
          kind: 'ghz',
          k: 5,
          banner: done.copy,
          intensity: done.intensity,
        });
      }
      if (!result.state.complete) completedRef.current = false;
      if (result.justHoledIn && result.scoreName) {
        optsRef.current.onEvent?.('golf hole finished', {
          qubits: result.hole.qubits,
          score: result.scoreName,
          course: result.state.course,
        });
        // Random bests are session-only — a generated hole 7 is a different
        // hole on every seed, so writing it would corrupt the device's card.
        if (persistsBest(result.state)) saveBest(store, result.state.best);
        optsRef.current.onCelebrate({
          kind: result.hole.qubits >= 3 ? 'ghz' : 'bell',
          k: result.hole.qubits,
          banner: `${scoreName(result.score, result.hole.par, tRef.current)}!`,
        });
      }
    },
    [pendingDeal, put, dealFresh],
  );

  // Switch courses (#70). Always a full re-tee on hole 1, and entering `random`
  // always deals a FRESH base seed — re-tapping "Random" is how you ask for a
  // new course. Classic reloads the device's persisted card; random starts with
  // an empty, session-only one. In build-on-screen mode the board is emptied
  // too, so the new hole 1 tees off from zero strokes instead of charging the
  // previous hole's leftover tiles as adds.
  //
  // Pocket ONLY: the kiosk (KioskView) stays on the classic course by design —
  // its surface is operator-layout-driven and unattended, while choosing a
  // random round is a per-visitor decision with nobody there to make it.
  //
  // A fresh random seed is never dealt yet, so Random goes through the dealer
  // and the switch (state, code setting, board) happens once the course is;
  // Classic needs no dealing and also calls off any deal still pending.
  const pickCourse = (course: GolfCourse) => {
    const seed = course === 'random' ? randomBaseSeed() : null;
    const enter = () => {
      const scope = stateRef.current.scope;
      put(
        seed === null
          ? initialGolfState(loadBest(storage), 'classic', 0, loadRevealed(storage), scope)
          : initialGolfState({}, 'random', seed, {}, scope),
      );
      // Keep the shareable code (#78) pointing at the course actually in play, so
      // the card, the drawer field and a copied link can never disagree.
      optsRef.current.setCourseCode(seed === null ? null : toCourseCode(seed));
      optsRef.current.clearBoard?.();
    };
    if (seed === null) {
      cancelDeal();
      enter();
    } else {
      dealCourse(seed, enter);
    }
  };

  // A code typed into the drawer (or arriving in the URL) switches courses. Only
  // fires when the code names a course we are NOT already playing, so it cannot
  // fight `pickCourse`, which writes the setting itself.
  // It is also what deals a code the page was OPENED with: the initial state
  // stays classic until that course is dealt (see the state initializer above).
  const codeSetting = options.courseCode;
  useEffect(() => {
    const seed = codeSetting === null ? null : parseCourseCode(codeSetting);
    const cur = stateRef.current;
    const store = optsRef.current.storage;
    if (seed === null) {
      // Clearing the code also calls off a code-or-link deal still pending.
      cancelDeal();
      if (cur.course !== 'random') return;
      put(initialGolfState(loadBest(store), 'classic', 0, loadRevealed(store), cur.scope));
      optsRef.current.clearBoard?.();
    } else {
      if (cur.course === 'random' && cur.randomSeed === seed) return;
      // Already on its way (a StrictMode re-run of this effect, say).
      if (pendingDeal() === seed) return;
      dealFresh(seed, () => optsRef.current.clearBoard?.());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeSetting]);

  // Advance/restart, shared by the scorecard button and the one floating by
  // the sphere (a phone player should not have to scroll down after holing
  // in). Build-on-screen only; camera keeps the physical clear-the-board
  // ritual. Empties the manual board, which IS the golf advance trigger; a
  // finished course restarts directly (finished RANDOM: brand-new seed, #70).
  const advanceHole = clearBoard
    ? () => {
        const cur = stateRef.current;
        if (cur.complete && cur.course === 'random') {
          // A brand-new seed: dealt first, then teed off (the board clears now
          // either way, and does not play while the course is dealt).
          dealFresh(randomBaseSeed());
        } else if (cur.complete) {
          const fresh = initialGolfState(cur.best, 'classic', 0, {}, cur.scope);
          // A new round deals every price afresh (#99): holes revealed last
          // time round are not still floored on this one.
          if (persistsBest(fresh)) saveRevealed(storage, fresh.revealed);
          put(fresh);
        }
        clearBoard();
      }
    : undefined;

  // Taking the mid-hole reveal (#99). The ENGINE marks the hole — the card only
  // asks — so the double-par floor lands in the recorded score through the same
  // path every other stroke takes, and a classic round remembers it across a
  // refresh exactly as it remembers a best.
  const takeReveal = (holeNumber: number) => {
    const cur = stateRef.current;
    const next = golfReveal(cur, holeNumber);
    if (next === cur) return;
    put(next);
    if (persistsBest(next)) saveRevealed(storage, next.revealed);
  };

  // Wipe the board for one flat stroke (#100), build-on-screen only. The ENGINE
  // charges it and empties the diff baseline first, so the board-clear that
  // follows is free — a per-gate teardown would have cost one stroke per tile
  // (#73), which is exactly the price this action exists to replace.
  const wipeBoard = clearBoard
    ? () => {
        const cur = stateRef.current;
        const next = golfWipe(cur, circuit);
        if (next === cur) return;
        put(next);
        clearBoard();
      }
    : undefined;

  // Pick what the competition is over (#102). Always a full re-tee on the
  // scope's first hole: a result only means something if both players played
  // the same holes from the same start, so switching scope mid-round would be
  // switching competition mid-competition. The setting is persisted and travels
  // in the share link, so a challenged friend lands in the same one.
  const pickScope = (scope: GolfScope) => {
    const cur = stateRef.current;
    put(
      cur.course === 'random'
        ? initialGolfState({}, 'random', cur.randomSeed, {}, scope)
        : initialGolfState(loadBest(storage), 'classic', 0, loadRevealed(storage), scope),
    );
    optsRef.current.setCourseScope(scopeCode(scope));
    optsRef.current.clearBoard?.();
  };

  // Tap a chip, play that hole (#101). The board is left exactly as it is and
  // becomes the new hole's baseline, so arriving costs nothing (#68) — and the
  // hole being left keeps its strokes, waiting for a player who comes back.
  const jumpToHole = (holeNumber: number) => {
    const cur = stateRef.current;
    const next = golfJumpTo(cur, holeNumber, circuit, courseHoles(cur));
    if (next === cur) return;
    put(next);
  };

  const holes = courseHoles(state);
  return {
    state,
    holes,
    currentLevel: holes[state.levelIndex],
    dealing,
    step,
    pickCourse,
    pickScope,
    advanceHole,
    takeReveal,
    wipeBoard,
    jumpToHole,
  };
}
