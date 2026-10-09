/**
 * English UI copy — the SOURCE OF TRUTH for every visitor-facing string.
 *
 * TRANSLATORS / CONTRIBUTORS: to add a string, add its key HERE first, then the
 * same key to `de.ts`. `de.ts` is typed as `Messages` (this object's type), so
 * TypeScript refuses a missing key or a function with a different signature,
 * and `i18n.test.ts` walks both trees: same keys, same function arity, same
 * array lengths, and no German string left identical to its English one
 * (except a short allowlist of brand names and gate symbols).
 *
 * Messages that need values are FUNCTIONS (`holeOf: (n, total) => …`), so
 * interpolation and plurals are type-checked — there is no runtime template
 * syntax. Plain strings stay plain strings.
 *
 * What stays English everywhere (not in here): the staff /debug view, console
 * text, gate symbols and names (H, X, CNOT, RX…), ket notation, and the brand
 * names Entangible, Quantina, IBM Quantum Composer and Qiskit. The Guide's long
 * prose lives beside the Guide (pocket-app/src/app/guide/), one file per
 * language behind one typed interface.
 */

/** Golf hole names on the classic course, by their English name (#70). */
const HOLE_NAMES: Record<string, string> = {
  Superposition: 'Superposition',
  'Bit flip': 'Bit flip',
  'Flipped GHZ-3': 'Flipped GHZ-3',
  'Flipped GHZ-4': 'Flipped GHZ-4',
  'Flipped GHZ-5': 'Flipped GHZ-5',
  'Minus GHZ-4': 'Minus GHZ-4',
  'Magic T': 'Magic T',
  Cascade: 'Cascade',
  'Golden GHZ': 'Golden GHZ',
};

export const en = {
  // ---------------------------------------------------------------- app shell
  app: {
    fullscreen: 'Fullscreen',
    exitFullscreen: 'Exit fullscreen',
    exit: 'Exit',
    installHintLead: 'For fullscreen, add Entangible to your Home Screen:',
    installHintAction: 'Share → Add to Home Screen',
    dismiss: 'Dismiss',
    guideAria: 'Guide and about',
    guideTitle: 'Guide & about',
    manualBuild: 'Manual build',
    disconnect: 'Disconnect',
    useCamera: 'Use camera',
    connectToBooth: 'Connect to booth',
    stop: 'Stop',
    starting: 'Starting…',
    startCamera: 'Start camera',
    cameraFallback: 'Selected camera unavailable — using default',
    matNotFound: "Can't find the mat — all four corners in view?",
    matLoadFailed: "Couldn't load the mat finder — check the connection and reload.",
    camBoardLocked: (fps: number) => `board locked · ${fps} fps`,
    camSearching: 'searching…',
    camOff: 'camera off',
    streamConnecting: 'Connecting to booth…',
    streamReconnecting: 'Reconnecting…',
    streamStopped: 'Stream stopped',
    streaming: (fps: number) => `Streaming to booth · ${fps} fps`,
    modeGolf: 'Quantum Golf',
    modeRunner: 'Quantum Runner',
  },

  // ------------------------------------------------------ camera panel + cards
  camera: {
    label: 'Camera',
    frozen: 'Frozen',
    freeze: 'Freeze',
    freezeCamera: 'Freeze camera',
    unfreezeCamera: 'Unfreeze camera',
    frozenMsg: (streaming: boolean) =>
      `Frozen — ${streaming ? 'stream paused' : 'circuit locked'}`,
    streamingHint: 'Streaming to the booth — this phone is the camera',
    connectingBooth: 'Connecting to the booth…',
    pointHint: 'Point at the board — all four corners in view',
    frameMat: 'Frame the mat',
    reframeMat: 'Re-frame the mat',
    matOnly: 'Mat only',
    unlockMat: 'Unlock — stream the full frame',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    expand: 'Expand camera',
    shrink: 'Shrink camera',
    errors: {
      insecure:
        'Camera needs a secure context (HTTPS or localhost). Open this page over HTTPS and allow camera access.',
      denied:
        'Camera permission was denied. Allow camera access in your browser settings and try again.',
      notFound: 'No camera was found on this device.',
      other: (name: string) => `Could not start the camera (${name}).`,
      unknown: 'unknown error',
      chunk: "The camera code didn't load — check the connection and reload the page.",
    },
  },

  lazy: {
    loading: 'Loading…',
    failed: 'This part of Entangible didn’t load — the connection dropped, or the site was just updated.',
    reload: 'Reload',
  },

  start: {
    intro:
      'Entangible lets you build a quantum circuit with your hands: lay printed tiles on the ' +
      'mat, point a camera at them, and watch the results appear live. No tiles or camera at ' +
      'hand — tap to build it on screen instead.',
    unavailable: 'Camera unavailable',
    startingBooth: 'Starting the booth camera…',
    pointIpad: 'Point your iPad at the board',
    streamingBody:
      'This phone is streaming its camera to the booth. Point it at the board from above; the booth screen shows the recognized circuit.',
    body: 'Start the camera, then frame the printed mat so all four corner markers are visible. Place tiles and watch the circuit build itself.',
    guideLink: 'New here? Read the guide',
    noCamera: 'No camera? Build on screen',
    buildInstead: 'Build on screen instead',
  },

  welcome: {
    aria: 'Choose how to start',
    startingCamera: 'Starting the camera…',
    camera: 'Point your camera at the board',
    cameraSub: 'All four corner markers in view',
    build: 'Build on screen',
    buildSub: 'No tiles needed',
    golf: 'Play Quantum Golf',
    golfSub: 'Hole by hole, on screen',
  },

  // ------------------------------------------------------------ settings drawer
  settings: {
    title: 'Settings',
    close: 'Close',
    mode: 'Mode',
    modes: {
      composer: 'Composer',
      golf: 'Quantum Golf',
      quantina: 'Quantina',
      runner: 'Quantum Runner',
    },
    golfCode: 'Golf course code',
    golfCodePlaceholder: 'classic course',
    golfCodeShared: 'Playing a shared random course. Clear the field for the classic 18.',
    golfCodeHint: 'Paste a course code to play someone else’s random 18.',
    menu: 'Menu',
    menuHint:
      'What a serve orders. Custom menus arrive via a ?menu= or ?menupack= link (see the menu-packs guide).',
    input: 'Input',
    inputCamera: 'Camera',
    inputManual: 'Build on screen',
    inputHint: 'No printer, no camera? Build gates on screen and play golf.',
    panels: 'Panels',
    panelLabels: {
      camera: 'Camera preview',
      results: 'Results',
      state: 'State',
      qasm: 'OpenQASM',
    },
    controlledByBooth: 'Controlled by booth.',
    wires: 'Wires',
    wiresAuto: 'auto',
    wiresAll: 'all 5',
    noise: 'Noise',
    noiseOptions: {
      off: 'Off',
      falcon: 'Falcon (2021, 5 qubits)',
      eagle: 'Eagle (127 qubits)',
      heron: "Heron (156 qubits — today's workhorse)",
      nighthawk: 'Nighthawk (newest generation)',
    },
    noiseHint:
      'Overlays results with a simulated-noise series — one preset per IBM chip generation, parameters from device calibration snapshots. Composer only — golf stays ideal.',
    camera: 'Camera',
    cameraAuto: 'Automatic (rear)',
    cameraPlaceholder: (n: number) => `Camera ${n}`,
    cameraNamesHint: 'Start the camera once to see camera names.',
    power: 'Power',
    lowPower: 'Low-power mode',
    guide: 'Guide & about',
    advanced: 'Staff & advanced',
    board: 'Board',
    boardGrid: 'More columns',
    boardStretch: 'Bigger cells',
    boardHint:
      'Corner blocks may span any rectangle. On a table bigger than the printed mat, "More columns" keeps the tile pitch and gives you extra columns; "Bigger cells" stretches the 8-column board to fit. A mat-sized board ignores this.',
    sidebarSide: 'Sidebar side',
    left: 'Left',
    right: 'Right',
    booth: 'Booth',
    boothIsCamera: 'This phone is the booth’s camera (streaming).',
    stopBeingCamera: 'Stop being the camera',
    boothConnected: 'Connected — viewing the booth (read-only).',
    disconnect: 'Disconnect',
    boothHost: 'Booth host',
    connect: 'Connect to booth',
    boothHint: 'Follow a booth’s screen and take its circuit home.',
    useAsCamera: 'Use this phone as the camera',
    useAsCameraHint: 'Stream this camera to the booth (staff). The booth does the detection.',
    developer: 'Developer',
    debugPanel: 'Debug panel',
  },

  /** The booth-viewer status pill (connected phone). */
  booth: {
    viewing: 'Connected to booth · viewing',
    connecting: 'Connecting to booth…',
    disconnected: 'Booth disconnected',
  },

  // ------------------------------------------------------ warnings + footer
  warnings: {
    inColumn: (column: number) => ` in column ${column}`,
    loneControl: (at: string) => `A ● control tile is missing its ⊕ partner${at}.`,
    loneTarget: (at: string) => `A ⊕ target tile is missing its ● partner${at}.`,
    cellConflict: (at: string) =>
      `Two tiles are competing for the same cell${at} — nudge one aside.`,
    offGrid: 'A tile is off the grid — slide it onto a cell.',
    loneSwap: (at: string) => `A SWAP tile is missing its partner${at} — SWAPs work in pairs.`,
    controlAmbiguous: (at: string) =>
      `A ● control has too many gates to choose from${at} — give it just one.`,
    unpairedMeasure:
      'A measurement block has no wire block across from it — line it up with a wire.',
    checkBoard: (at: string) => `Check the board${at}.`,
    cameraLost: 'Camera lost — check the cable',
  },

  /** The rotating footer ticker (pocket + kiosk). */
  hints: [
    '● and ⊕ in the same column make a CNOT — entanglement in one move.',
    'An H tile puts a qubit into superposition — 0 and 1 at once.',
    'Place tiles left-to-right; each column is one step in time.',
    'Two entangled qubits always agree — measure one, know the other.',
  ],

  /** The message strip's "moments" (composer mode). */
  moments: {
    ready: 'Ready for the next quantum architect',
    bell: 'These qubits now answer together — measure one, know the other',
    alive: (q: string) => `${q} is alive!`,
    uniform: '32 possibilities at once',
    superposition: (q: string) => `Superposition — ${q} is 0 and 1`,
    bitFlip: (q: string) => `Bit flip — ${q} is now 1`,
  },

  celebrations: {
    ghz: (k: number) => `GHZ STATE — ${k} QUBITS ENTANGLED!`,
    entanglement: 'ENTANGLEMENT!',
  },

  /** Tap-to-inspect popovers: what a gate does / what an outcome means. */
  inspect: {
    h: (q: string) => `H puts ${q} into superposition — it is 0 and 1 at once.`,
    x: (q: string) => `X flips ${q}: |0⟩ becomes |1⟩ (a quantum NOT).`,
    y: (q: string) => `Y flips ${q} and adds a phase — a bit-flip and phase-flip together.`,
    z: (q: string) => `Z leaves 0 alone but flips the phase of 1 on ${q} (a phase flip).`,
    s: (q: string) => `S adds a quarter-turn phase to ${q} (a √Z gate).`,
    t: (q: string) => `T adds an eighth-turn phase to ${q} (a √S gate).`,
    cnot: (control: string, target: string) =>
      `A ●⊕ pair is a CNOT: it flips ${target} whenever ${control} is 1 — the move that entangles them.`,
    rx: (q: string, angle: string) =>
      `RX turns ${q} around the X axis by ${angle} — a tunable bit-flip.`,
    ry: (q: string, angle: string) =>
      `RY turns ${q} around the Y axis by ${angle} — dials in a partial superposition.`,
    sAsRz: (q: string, angle: string) =>
      `S adds a quarter-turn phase to ${q} (a √Z gate, sent as RZ ${angle}).`,
    tAsRz: (q: string, angle: string) =>
      `T adds an eighth-turn phase to ${q} (a √S gate, sent as RZ ${angle}).`,
    rz: (q: string, angle: string) => `RZ rotates ${q}'s phase by ${angle} around the Z axis.`,
    other: (q: string) => `This gate acts on ${q}.`,
    outcome: (bits: string, pairs: string, percent: string) =>
      `${bits}: ${pairs} — seen in ${percent} of runs.`,
  },

  // ------------------------------------------------------------------ golf
  golf: {
    rounds: {
      easy: 'Easy',
      medium: 'Medium',
      difficult: 'Difficult',
      extra: 'Extra',
    },
    full18: 'Full 18',
    score: {
      eagle: 'EAGLE',
      birdie: 'BIRDIE',
      par: 'PAR',
      over: (over: number) => `HOLE IN +${over}`,
    },
    /** Course-end banners (#80); `time` is `inTime(…)` or ''. */
    completion: {
      inTime: (duration: string) => ` in ${duration}`,
      legendary: (under: number, time: string) => `Legendary round — ${under} under par${time}!`,
      under: (under: number, time: string) => `${under} under par${time}!`,
      even: (time: string) => `Even par — course complete${time}!`,
      over: (vsPar: string, time: string) => `Course complete — ${vsPar}${time}.`,
    },
    holeNames: HOLE_NAMES,
    randomHole: (code: string) => `Random ${code}`,
    // The pocket golf sidebar.
    course: 'Course',
    courseAria: 'golf course',
    classic18: 'Classic 18',
    random18: 'Random 18',
    newRandom18: 'New random 18',
    scopeAria: 'competition scope',
    nextHole: 'Next hole ▸',
    playAgain: 'Play again ▸',
    dealing: (hole: number, total: number) => `Dealing course — hole ${hole}/${total}…`,
    dealingAria: 'holes dealt',
  },

  scorecard: {
    scopeOnly: (round: string) => `${round} round only`,
    randomRound: 'Random round',
    copyLink: 'Copy a link to this course',
    linkCopied: 'link copied',
    courseCode: (code: string) => `Course #${code}`,
    /** `round` is null for the full course. */
    headerComplete: (round: string | null) =>
      `Scorecard · ${round === null ? 'course' : `${round} round`} complete`,
    courseComplete: (round: string | null) =>
      round === null ? 'Course complete! ⛳' : `${round} round complete! ⛳`,
    strokesPar: (strokes: number, par: number) => `${strokes} strokes · par ${par}`,
    strokesIn: 'strokes in',
    vsPar: 'vs par',
    playAgain: 'Play again ▸',
    clearToPlayAgain: 'clear the board to play again',
    header: (round: string, hole: number, holes: number) =>
      `Scorecard · ${round} · hole ${hole}/${holes}`,
    qubitsClubs: (qubits: number, clubs: string) =>
      `${qubits} ${qubits === 1 ? 'qubit' : 'qubits'} · clubs: ${clubs}`,
    target: 'Target',
    par: 'par',
    strokes: 'strokes',
    fidelity: 'fidelity',
    best: 'best',
    total: 'total',
    time: 'time',
    wipe: 'Wipe board (+1 stroke)',
    nextHole: 'Next hole ▸',
    clearForNext: 'clear the board for the next hole',
    atLeast: (score: number) => `this hole scores at least ${score}`,
    hideSolution: 'Hide solution',
    showSolutionPrice: (price: number) => `Show solution (scores double par — ${price})`,
    stuck: 'Stuck? Show solution',
    showSolution: 'Show solution',
    solutionOptimal: 'Solution — optimal',
    dealtSolution: 'Dealt solution',
    solution: 'Solution',
    optimal: (gates: number) => `Optimal (${gates} ${gates === 1 ? 'gate' : 'gates'})`,
    allHoles: 'all holes',
    chipTitle: (code: string, name: string, par: number) => `${code} · ${name} · par ${par}`,
    chipTitleBest: (code: string, name: string, par: number, best: number, vsPar: string) =>
      `${code} · ${name} · par ${par} · best ${best} (${vsPar})`,
    tapToPlay: ' — tap to play',
    playHole: (hole: number, code: string) => `Play hole ${hole}, ${code}`,
    solutionCircuit: 'solution circuit',
  },

  /** "Challenge a friend" (#84) — the random course's share QR. */
  challenge: {
    button: 'Multi player',
    aria: 'Multi player — share this course',
    title: 'Show a QR code for this course',
    dialog: 'Multi player — QR code for this course',
    hintFull: 'Scan to play the same course — same 18 holes, same pars.',
    hintRound: (round: string) =>
      `Scan to play the same ${round.toLowerCase()} round — same holes, same pars.`,
    code: (code: string, round: string | null) =>
      `Course #${code}${round === null ? '' : ` · ${round} round`}`,
    subhint: 'Compare strokes and time when you both finish.',
    close: 'Close',
  },

  /**
   * The golf goal line (shared/display/goalLine.ts). Every template is a claim
   * about measurement outcomes (and phase) that holds EXACTLY for the state it
   * is chosen for — the line may be vague but never wrong, in every language.
   */
  goal: {
    sentence: (body: string, twist: string | null) =>
      twist === null ? `Goal: ${body}.` : `Goal: ${body}, plus ${twist}.`,
    fallback: 'Goal: match the target state shown.',
    certainOne: 'make the ball certain to land on 1 — flip it',
    certainZero: 'make the ball certain to land on 0',
    certain: (balls: number, bits: string) =>
      `make ${balls === 2 ? 'both balls' : `all ${balls} balls`} certain to land on ${bits}`,
    fairCoin: 'a fair 50/50 coin',
    agree: (balls: number) =>
      balls === 2
        ? 'entangle the two balls so they always agree'
        : `entangle all ${balls} balls so they always agree`,
    disagree: 'entangle the two balls so they always disagree',
    complement: (balls: number, a: string, b: string) =>
      `entangle all ${balls} balls — always ${a} or ${b}, 50/50`,
    oneCoin: (a: string, b: string) =>
      `one ball a fair 50/50 coin, the rest certain — ${a} or ${b}`,
    someEntangled: (entangled: number, balls: number, a: string, b: string) =>
      `entangle ${entangled} of the ${balls} balls — always ${a} or ${b}, 50/50`,
    allCoins: (balls: number) =>
      balls === 1
        ? 'make the ball a fair 50/50 coin'
        : `make ${balls === 2 ? 'both balls' : `all ${balls} balls`} fair 50/50 coins`,
    equallyLikely: (outcomes: number) => `${outcomes} outcomes, all equally likely`,
    twist: {
      half: 'a half-turn phase twist',
      quarter: 'a quarter-turn phase twist',
      eighth: 'an eighth-turn phase twist',
      threeEighths: 'a three-eighths-turn phase twist',
      any: 'a phase twist',
    },
  },

  // --------------------------------------------------------- state displays
  evolving: {
    bloch: 'Bloch sphere',
    qsphere: 'Q-sphere',
    state: 'State',
    target: 'Target',
    stepsAria: 'State evolution steps',
    replay: 'Replay animation',
    prev: 'Previous step',
    next: 'Next step',
    goTo: (step: string) => `Go to ${step}`,
    start: 'start',
    afterLayer: (layer: number) => `after layer ${layer}`,
    blochTitle: 'Bloch sphere state projection',
    qsphereTitle: 'Q-sphere state projection',
    resetOrientation: 'Reset orientation',
    phaseLegend: 'phase color legend',
    ketAria: (label: string) => `${label} in bra-ket notation`,
    ketAriaCurrent: 'Current state in bra-ket notation',
  },

  histogram: {
    results: 'Results',
    eightOutcomes: 'Results · 8 outcomes',
    placeTile: 'Place a tile to see outcomes',
    top: (shown: number) => `Results · top ${shown}`,
    outcomes: (n: number) => `Results · ${n} outcomes`,
    topOf: (shown: number, of: number) => `Results · top ${shown} of ${of}`,
    shownOf: (shown: number, total: number) => `Results · ${shown} of ${total} outcomes`,
    more: (n: number) => `+ ${n} more outcomes`,
    moreEach: (n: number, pct: string) => `+ ${n} more outcomes ≤ ${pct}% each`,
    uniform: (pct: string, total: number, suffix: string) =>
      `all outcomes ≈ ${pct}% — ${total} equally likely${suffix}`,
    /** The kiosk's uniform-note suffix. */
    possibilities: ' possibilities',
    ideal: 'ideal',
    withNoise: 'with noise',
  },

  statePanel: {
    label: 'State',
    touched: 'qubits touched',
    gates: 'gates',
    columns: 'columns',
  },

  // ------------------------------------------------- IBM Composer hand-off
  composer: {
    copied:
      'Composer opened with your circuit — sign in (free) to run it on a real quantum computer.',
    noCopy: 'Composer opened with your circuit — sign in (free) to run it on real hardware.',
    signIn:
      'Uses all 5 qubits — sign in to IBM Quantum to simulate it there (up to 4 without an account).',
    syncEnabled:
      'Composer tab opened — it will follow the table. Sign in (free) to run on real hardware.',
    transfer: 'Transfer to IBM Composer',
    transferNote: 'Copies your circuit and opens it on IBM Quantum.',
    live: 'Live Composer',
    liveSyncing: 'Live Composer · syncing',
    liveOnTitle: 'The Composer tab is following the table — tap to stop',
    liveOffTitle: 'Open a Composer tab that follows the table live',
    qrAria: 'Show a QR code for your circuit',
    qrTitle: 'QR — open your circuit in the IBM Quantum Composer',
    qrDialog: 'QR code — open your circuit in the IBM Quantum Composer',
    close: 'Close',
    qrCaption:
      'Scan to open YOUR circuit in the IBM Quantum Composer — sign in (free) to run it on a real quantum computer',
    qrCaptionOverlong:
      'This circuit is too large to pack into a QR — use the Transfer button (it also copies the QASM to your clipboard) to open it in the IBM Quantum Composer.',
    disclaimer: 'Independent project — not affiliated with IBM.',
    kioskLabel: 'Your circuit → IBM Composer',
    kioskCaption:
      'Scan to open this circuit in the IBM Quantum Composer — independent project, not affiliated with IBM.',
  },

  // ---------------------------------------------------------------- Quantina
  quantina: {
    scoops: 'Scoops',
    shotsAria: 'Number of shots',
    fewer: 'Fewer',
    more: 'More',
    serve: 'Serve',
    loadError: (error: string, fallback: string) =>
      `Couldn’t load that menu (${error}) — showing ${fallback}.`,
    youOrdered: 'You ordered',
    justTheGlass: 'just the glass',
    shotSource: {
      ideal: 'sampled from the ideal state',
      noisy: 'sampled with hardware noise',
      real: 'measured on real hardware',
    },
    realHardware:
      'Want it from real hardware? Scan the circuit QR, run it with ONE shot on your own device, and tell the staff your bitstring.',
    /**
     * The built-in menus' visitor copy, by pack id and item code (or `q<n>` for
     * a subset pack's qubit items). Pack TITLES are brand names and stay as
     * they are; custom and remote packs are shown exactly as authored.
     */
    packs: {
      coffee: {
        tagline: 'Order your coffee with a quantum computer',
        items: {
          '000': 'Tea',
          '001': 'Hot Chocolate',
          '011': 'Coffee',
          '110': 'Viennese Melange',
        },
        subtitles: {},
      },
      cocktails: {
        tagline: 'Mix your drink with a quantum computer',
        items: {
          '111': 'Water',
        },
        subtitles: {},
      },
      icecream: {
        tagline: 'Scoops by superposition',
        items: {
          '000': 'Strawberry',
          '001': 'Lemon',
          '010': 'Lemon/Cuke',
          '100': 'Sesame',
          '101': 'Chocolate',
          '110': 'Salted Peanut',
          '111': 'Melted :(',
        },
        subtitles: {
          '111': 'the honest answer to leftover amplitude',
        },
      },
      juice: {
        tagline: 'Every set bit lands in your glass',
        items: {
          q0: 'Orange juice',
          q2: 'Sparkling water',
        },
        subtitles: {
          q0: 'the sunny base of every glass',
          q1: 'a tropical splash when its bit is set',
          q2: 'the fizz — entangle it to always fizz together',
        },
      },
      demo: {
        tagline: 'The four-outcome docs & test pack',
        items: {},
        subtitles: {},
      },
    } as Record<
      string,
      {
        tagline: string;
        items: Record<string, string>;
        subtitles: Record<string, string>;
      }
    >,
  },

  // ---------------------------------------------------------- Quantum Runner
  runner: {
    score: 'Score',
    lives: (n: number) => `${n} lives`,
    level: 'Level',
    oneQubit: '1 qubit',
    twoQubits: '2 qubits',
    gates: 'Gates',
    gameOver: 'Game over',
    overTitle: 'Measurement got you',
    overFlavour: 'A projective measurement collapsed you into an obstacle one time too many.',
    distance: 'Distance',
    meters: (m: number) => `${m} m`,
    runAgain: 'Run again',
  },

  // ------------------------------------------------------------------ kiosk
  kiosk: {
    live: 'live',
    reconnecting: 'reconnecting',
    offline: 'offline',
    disconnectedRetrying: 'Booth disconnected — retrying…',
    connecting: 'Connecting to the booth…',
    pendingHint: 'The big screen mirrors the booth. Waiting for the host to come online.',
    /** The topbar's mode pill (the host's mode id, by name). */
    modes: {
      composer: 'composer',
      golf: 'golf',
      quantina: 'quantina',
      attract: 'attract',
    } as Record<string, string>,
    iphoneCamera: 'iPhone camera',
    viewers: (n: number) => `${n} viewers`,
    presentedAt: 'presented at',
    eventLogo: 'event logo',
    camera: 'Camera',
    liveCamera: 'Live booth camera',
    visitorQr: 'Scan to follow along + take your circuit home',
    attractLabel: (event: string | null) =>
      event === null
        ? 'Entangible — place a tile on the table to begin'
        : `Entangible at ${event} — place a tile on the table to begin`,
    attractAt: 'at',
    attractTaglines: [
      'Build a quantum circuit with your hands — place a tile on the table',
      'Order your coffee with a quantum computer',
    ],
    attractSite: 'entangible.org · a Fun with Quantum project',
    noisyRun: 'Run on a noisy simulator',
    noisyRunning: 'Running…',
    noisyIdeal: 'ideal',
    noisyNoisy: 'noisy',
    noisyIdealTitle: (pct: string) => `ideal ${pct}%`,
    noisyNoisyTitle: (pct: string) => `noisy ${pct}%`,
    noisyMessage: 'Real quantum computers are noisy — see the difference',
  },

  // ------------------------------------------------------------------ guide
  /** The Guide's chrome; its prose is in pocket-app/src/app/guide/. */
  guide: {
    back: 'Back',
    aria: 'Guide and about',
    navAria: 'Guide sections',
    sectionAria: (title: string) => `${title} — guide section`,
    sections: {
      start: { nav: 'Start here', title: 'Start here' },
      print: { nav: 'Print the kit', title: 'Print the kit' },
      play: { nav: 'Play', title: 'Play' },
      build: { nav: 'Build on screen', title: 'Build on screen' },
      booth: { nav: 'Booth & project', title: 'Booth and project' },
    },
    testBoardAria: (title: string) => `Test board: ${title}`,
    prevBoard: 'Previous board',
    nextBoard: 'Next board',
    close: 'Close',
    /** On-screen test boards, by id (pocket-app/src/app/testBoards.ts). */
    testBoards: {
      '01-empty': { title: 'Empty board', blurb: 'Corners only — expect an empty circuit.' },
      '02-single-h': {
        title: 'H on q0',
        blurb: 'A single Hadamard — one qubit in superposition.',
      },
      '03-bell': {
        title: 'Bell pair',
        blurb: 'H then CNOT — expect the entanglement celebration.',
      },
      '04-ghz3': {
        title: 'GHZ-3',
        blurb: 'A CNOT chain — repeated ●/⊕ ids exercise spatial dedupe.',
      },
      '05-ghz5': { title: 'GHZ-5', blurb: 'Full-height CNOT staircase — golf hole 5.' },
      '06-all-families': {
        title: 'Every gate family',
        blurb: 'One of each, including S/T and rotations.',
      },
      '07-uniform-32': {
        title: 'H on all five qubits',
        blurb: '32 equally likely outcomes — a histogram stress test.',
      },
      '08-lone-control': {
        title: 'Lone control',
        blurb: 'A ● with no ⊕ partner — a friendly warning, no CNOT.',
      },
      '09-dials': {
        title: 'Dial tiles',
        blurb: 'RX/RY/RZ dials — the tile’s rotation selects the angle.',
      },
      '10-swap': {
        title: 'SWAP tiles',
        blurb: 'Two × tiles in one column swap the qubits — emitted as three CNOTs.',
      },
    } as Record<string, { title: string; blurb: string }>,
  },
};

/**
 * The shape every language must provide: `en`'s own type. `en` is a plain
 * (non-`const`) literal, so its strings are already widened to `string` and its
 * functions keep their annotated signatures.
 */
export type Messages = typeof en;

export default en;
