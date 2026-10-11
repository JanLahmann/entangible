/**
 * German UI copy (Deutsch). Typed as `Messages`, so every key of `en.ts` must
 * exist here with the same function signatures; `i18n.test.ts` additionally
 * checks the key trees, arities and array lengths match, and that nothing was
 * left in English by accident.
 *
 * Style: informal "du" throughout (visitors are kids and students at fairs),
 * short and natural rather than literal; standard German quantum terms
 * (Überlagerung, Verschränkung, Messung, Wahrscheinlichkeit, Qubit, Gatter,
 * Phase, Zustand); German typography („…“, – with spaces). Golf's score words
 * (Eagle, Birdie, Par) are the ones German golfers use too.
 */
import type { Messages } from './en';

/** Golf hole names on the classic course, by their English name (#70). */
const HOLE_NAMES: Record<string, string> = {
  Superposition: 'Überlagerung',
  'Bit flip': 'Bitflip',
  'Flipped GHZ-3': 'Gekipptes GHZ-3',
  'Flipped GHZ-4': 'Gekipptes GHZ-4',
  'Flipped GHZ-5': 'Gekipptes GHZ-5',
  'Minus GHZ-4': 'Minus-GHZ-4',
  'Magic T': 'Magisches T',
  Cascade: 'Kaskade',
  'Golden GHZ': 'Goldenes GHZ',
};

/** "beide Kugeln" / "alle 3 Kugeln" — how many balls a clause is about (k ≥ 2). */
const kugeln = (k: number) => (k === 2 ? 'beide Kugeln' : `alle ${k} Kugeln`);

/** German decimal comma for a pre-formatted number ("3.1" → "3,1"). */
const comma = (n: string) => n.replace('.', ',');

export const de: Messages = {
  // ---------------------------------------------------------------- app shell
  app: {
    fullscreen: 'Vollbild',
    exitFullscreen: 'Vollbild beenden',
    exit: 'Beenden',
    installHintLead: 'Für Vollbild füge Entangible zu deinem Home-Bildschirm hinzu:',
    installHintAction: 'Teilen → Zum Home-Bildschirm',
    dismiss: 'Schließen',
    guideAria: 'Anleitung und Infos',
    guideTitle: 'Anleitung & Infos',
    manualBuild: 'Am Bildschirm',
    disconnect: 'Trennen',
    useCamera: 'Kamera nutzen',
    connectToBooth: 'Mit Stand verbinden',
    stop: 'Stopp',
    starting: 'Startet…',
    startCamera: 'Kamera starten',
    cameraFallback: 'Gewählte Kamera nicht verfügbar – nutze die Standardkamera',
    matNotFound: 'Matte nicht gefunden – sind alle vier Ecken im Bild?',
    matLoadFailed: 'Die Mattensuche wurde nicht geladen – prüf die Verbindung und lade neu.',
    camBoardLocked: (fps: number) => `Brett erkannt · ${fps} fps`,
    camSearching: 'sucht…',
    camOff: 'Kamera aus',
    streamConnecting: 'Verbinde mit dem Stand…',
    streamReconnecting: 'Verbinde neu…',
    streamStopped: 'Stream gestoppt',
    streaming: (fps: number) => `Streamt zum Stand · ${fps} fps`,
    modeGolf: 'Quanten-Golf',
    modeRunner: 'Quantum Runner',
  },

  // ------------------------------------------------------ camera panel + cards
  camera: {
    label: 'Kamera',
    frozen: 'Eingefroren',
    freeze: 'Einfrieren',
    freezeCamera: 'Kamera einfrieren',
    unfreezeCamera: 'Kamera fortsetzen',
    frozenMsg: (streaming: boolean) =>
      `Eingefroren – ${streaming ? 'Stream pausiert' : 'Schaltung festgehalten'}`,
    streamingHint: 'Streamt zum Stand – dieses Handy ist die Kamera',
    connectingBooth: 'Verbinde mit dem Stand…',
    pointHint: 'Richte die Kamera aufs Brett – alle vier Ecken im Bild',
    frameMat: 'Matte einrahmen',
    reframeMat: 'Matte neu einrahmen',
    matOnly: 'Nur Matte',
    unlockMat: 'Lösen – ganzes Bild streamen',
    zoomIn: 'Hineinzoomen',
    zoomOut: 'Herauszoomen',
    expand: 'Kamera vergrößern',
    shrink: 'Kamera verkleinern',
    errors: {
      insecure:
        'Die Kamera braucht eine sichere Verbindung (HTTPS oder localhost). Öffne diese Seite über HTTPS und erlaube den Kamerazugriff.',
      denied:
        'Der Kamerazugriff wurde verweigert. Erlaube ihn in den Browser-Einstellungen und versuch es noch einmal.',
      notFound: 'Auf diesem Gerät wurde keine Kamera gefunden.',
      other: (name: string) => `Die Kamera ließ sich nicht starten (${name}).`,
      unknown: 'unbekannter Fehler',
      chunk: 'Der Kamera-Code wurde nicht geladen – prüf die Verbindung und lade die Seite neu.',
    },
  },

  lazy: {
    loading: 'Wird geladen …',
    failed: 'Dieser Teil von Entangible wurde nicht geladen – die Verbindung ist abgebrochen oder die Seite wurde gerade aktualisiert.',
    reload: 'Neu laden',
  },

  start: {
    intro:
      'Mit Entangible baust du einen Quantenschaltkreis mit deinen Händen: Leg gedruckte ' +
      'Plättchen auf die Matte, richte eine Kamera darauf und sieh live zu, wie die Ergebnisse ' +
      'erscheinen. Keine Plättchen oder Kamera zur Hand? Dann bau ihn einfach am Bildschirm.',
    unavailable: 'Kamera nicht verfügbar',
    startingBooth: 'Stand-Kamera startet…',
    pointIpad: 'Richte dein iPad auf das Brett',
    streamingBody:
      'Dieses Handy streamt seine Kamera zum Stand. Halte es von oben auf das Brett; der Bildschirm am Stand zeigt die erkannte Schaltung.',
    body: 'Starte die Kamera und rahme die gedruckte Matte so ein, dass alle vier Eckmarker zu sehen sind. Leg Plättchen und sieh zu, wie sich die Schaltung von selbst aufbaut.',
    guideLink: 'Neu hier? Lies die Anleitung',
    noCamera: 'Keine Kamera? Am Bildschirm bauen',
    buildInstead: 'Stattdessen am Bildschirm bauen',
  },

  welcome: {
    aria: 'Wähle, wie du starten willst',
    startingCamera: 'Kamera startet…',
    camera: 'Kamera aufs Brett richten',
    cameraSub: 'Alle vier Eckmarker im Bild',
    build: 'Am Bildschirm bauen',
    buildSub: 'Ohne Plättchen',
    golf: 'Quanten-Golf spielen',
    golfSub: 'Loch für Loch, am Bildschirm',
  },

  // ------------------------------------------------------------ settings drawer
  settings: {
    title: 'Einstellungen',
    close: 'Schließen',
    mode: 'Modus',
    modes: {
      composer: 'Composer',
      golf: 'Quanten-Golf',
      quantina: 'Quantina',
      runner: 'Quantum Runner',
    },
    golfCode: 'Golfplatz-Code',
    golfCodePlaceholder: 'klassischer Platz',
    golfCodeShared:
      'Du spielst einen geteilten Zufallsplatz. Leere das Feld für die klassischen 18.',
    golfCodeHint: 'Füge einen Platz-Code ein, um die Zufalls-18 von jemand anderem zu spielen.',
    menu: 'Menü',
    menuHint:
      'Was ein Servieren bestellt. Eigene Menüs kommen über einen ?menu=- oder ?menupack=-Link (siehe Anleitung zu Menü-Paketen).',
    input: 'Eingabe',
    inputCamera: 'Kamera',
    inputManual: 'Am Bildschirm',
    inputHint: 'Kein Drucker, keine Kamera? Bau Gatter am Bildschirm und spiel Golf.',
    panels: 'Ansichten',
    panelLabels: {
      camera: 'Kameravorschau',
      results: 'Ergebnisse',
      state: 'Zustand',
      qasm: 'OpenQASM-Code',
    },
    controlledByBooth: 'Wird vom Stand gesteuert.',
    wires: 'Leitungen',
    wiresAuto: 'automatisch',
    wiresAll: 'alle 5',
    noise: 'Rauschen',
    noiseOptions: {
      off: 'Aus',
      falcon: 'Falcon (2021, 5 Qubits)',
      eagle: 'Eagle (127 Qubits)',
      heron: 'Heron (156 Qubits – heutiges Arbeitspferd)',
      nighthawk: 'Nighthawk (neueste Generation)',
    },
    noiseHint:
      'Legt eine simulierte Rausch-Reihe über die Ergebnisse – ein Profil pro IBM-Chipgeneration, mit Werten aus echten Kalibrierungsdaten. Nur im Composer – Golf bleibt ideal.',
    camera: 'Kamera',
    cameraAuto: 'Automatisch (Rückkamera)',
    cameraPlaceholder: (n: number) => `Kamera ${n}`,
    cameraNamesHint: 'Starte die Kamera einmal, um die Kameranamen zu sehen.',
    power: 'Energie',
    lowPower: 'Stromsparmodus',
    guide: 'Anleitung & Infos',
    advanced: 'Standteam & Erweitert',
    board: 'Brett',
    boardGrid: 'Mehr Spalten',
    boardStretch: 'Größere Felder',
    boardHint:
      'Eckblöcke dürfen ein beliebiges Rechteck aufspannen. Auf einem Tisch, der größer als die gedruckte Matte ist, behält „Mehr Spalten“ den Plättchenabstand und gibt dir zusätzliche Spalten; „Größere Felder“ streckt das Brett mit 8 Spalten auf die volle Größe. Ein Brett in Mattengröße ignoriert diese Einstellung.',
    sidebarSide: 'Seitenleiste',
    left: 'Links',
    right: 'Rechts',
    booth: 'Stand',
    boothIsCamera: 'Dieses Handy ist die Kamera des Stands (streamt).',
    stopBeingCamera: 'Nicht mehr Kamera sein',
    boothConnected: 'Verbunden – du siehst den Stand (nur ansehen).',
    disconnect: 'Trennen',
    boothHost: 'Stand-Adresse',
    connect: 'Mit Stand verbinden',
    boothHint: 'Folge dem Bildschirm eines Stands und nimm seine Schaltung mit nach Hause.',
    useAsCamera: 'Dieses Handy als Kamera nutzen',
    useAsCameraHint:
      'Streamt diese Kamera zum Stand (Personal). Die Erkennung macht der Stand.',
    developer: 'Entwicklung',
    debugPanel: 'Debug-Ansicht',
  },

  booth: {
    viewing: 'Mit Stand verbunden · zuschauen',
    connecting: 'Verbinde mit dem Stand…',
    disconnected: 'Stand getrennt',
  },

  // ------------------------------------------------------ warnings + footer
  warnings: {
    inColumn: (column: number) => ` in Spalte ${column}`,
    loneControl: (at: string) => `Einem ●-Steuerplättchen fehlt sein ⊕-Partner${at}.`,
    loneTarget: (at: string) => `Einem ⊕-Zielplättchen fehlt sein ●-Partner${at}.`,
    cellConflict: (at: string) =>
      `Zwei Plättchen streiten sich um dasselbe Feld${at} – schieb eins zur Seite.`,
    offGrid: 'Ein Plättchen liegt neben dem Raster – schieb es auf ein Feld.',
    loneSwap: (at: string) =>
      `Einem SWAP-Plättchen fehlt sein Partner${at} – SWAPs gibt es nur paarweise.`,
    controlAmbiguous: (at: string) =>
      `Ein ●-Steuerplättchen hat zu viele Gatter zur Auswahl${at} – gib ihm nur eins.`,
    unpairedMeasure:
      'Einem Messblock gegenüber liegt kein Leitungsblock – richte ihn an einer Leitung aus.',
    checkBoard: (at: string) => `Prüf das Brett${at}.`,
    cameraLost: 'Kamera weg – prüf das Kabel',
    cameraMissing: 'Keine Kamera gefunden – steck eine USB-Kamera an oder setz QAMPOSER_SOURCE',
  },

  hints: [
    '● und ⊕ in derselben Spalte ergeben ein CNOT – Verschränkung mit einem Zug.',
    'Ein H-Plättchen bringt ein Qubit in Überlagerung – 0 und 1 zugleich.',
    'Leg Plättchen von links nach rechts; jede Spalte ist ein Zeitschritt.',
    'Zwei verschränkte Qubits stimmen immer überein – miss eins und du kennst das andere.',
  ],

  moments: {
    ready: 'Brett frei – wer baut als Nächstes?',
    bell: 'Diese Qubits antworten jetzt gemeinsam – miss eins und du kennst das andere',
    alive: (q: string) => `${q} lebt!`,
    uniform: '32 Möglichkeiten auf einmal',
    superposition: (q: string) => `Überlagerung – ${q} ist 0 und 1`,
    bitFlip: (q: string) => `Bitflip – ${q} ist jetzt 1`,
  },

  celebrations: {
    ghz: (k: number) => `GHZ-ZUSTAND – ${k} QUBITS VERSCHRÄNKT!`,
    entanglement: 'VERSCHRÄNKUNG!',
  },

  inspect: {
    h: (q: string) => `H bringt ${q} in Überlagerung – es ist 0 und 1 zugleich.`,
    x: (q: string) => `X kippt ${q}: Aus |0⟩ wird |1⟩ (ein Quanten-NOT).`,
    y: (q: string) => `Y kippt ${q} und fügt eine Phase hinzu – Bitflip und Phasenflip zusammen.`,
    z: (q: string) => `Z lässt 0 in Ruhe, dreht aber auf ${q} die Phase der 1 um (ein Phasenflip).`,
    s: (q: string) => `S gibt ${q} eine Viertel-Phasendrehung (ein √Z-Gatter).`,
    t: (q: string) => `T gibt ${q} eine Achtel-Phasendrehung (ein √S-Gatter).`,
    cnot: (control: string, target: string) =>
      `Ein ●⊕-Paar ist ein CNOT: Es kippt ${target}, wann immer ${control} 1 ist – der Zug, der die beiden verschränkt.`,
    rx: (q: string, angle: string) =>
      `RX dreht ${q} um ${angle} um die X-Achse – ein einstellbarer Bitflip.`,
    ry: (q: string, angle: string) =>
      `RY dreht ${q} um ${angle} um die Y-Achse – stellt eine teilweise Überlagerung ein.`,
    sAsRz: (q: string, angle: string) =>
      `S gibt ${q} eine Viertel-Phasendrehung (ein √Z-Gatter, gesendet als RZ ${angle}).`,
    tAsRz: (q: string, angle: string) =>
      `T gibt ${q} eine Achtel-Phasendrehung (ein √S-Gatter, gesendet als RZ ${angle}).`,
    rz: (q: string, angle: string) => `RZ dreht die Phase von ${q} um ${angle} um die Z-Achse.`,
    other: (q: string) => `Dieses Gatter wirkt auf ${q}.`,
    outcome: (bits: string, pairs: string, percent: string) =>
      `${bits}: ${pairs} – kam in ${percent.replace('%', ' %')} der Durchläufe vor.`,
  },

  // ------------------------------------------------------------------ golf
  golf: {
    rounds: {
      easy: 'Leicht',
      medium: 'Mittel',
      difficult: 'Schwer',
      extra: 'Bonus',
    },
    full18: 'Alle 18',
    score: {
      eagle: 'EAGLE',
      birdie: 'BIRDIE',
      par: 'PAR',
      over: (over: number) => `EINGELOCHT MIT +${over}`,
    },
    completion: {
      inTime: (duration: string) => ` in ${duration}`,
      legendary: (under: number, time: string) =>
        `Legendäre Runde – ${under} unter Par${time}!`,
      under: (under: number, time: string) => `${under} unter Par${time}!`,
      even: (time: string) => `Genau Par – Platz geschafft${time}!`,
      over: (vsPar: string, time: string) => `Platz geschafft – ${vsPar}${time}.`,
    },
    holeNames: HOLE_NAMES,
    randomHole: (code: string) => `Zufall ${code}`,
    course: 'Platz',
    courseAria: 'Golfplatz',
    classic18: 'Klassische 18',
    random18: 'Zufalls-18',
    newRandom18: 'Neue Zufalls-18',
    scopeAria: 'Wertung',
    nextHole: 'Nächstes Loch ▸',
    playAgain: 'Noch mal ▸',
    dealing: (hole: number, total: number) => `Platz wird erstellt – Loch ${hole}/${total}…`,
    dealingAria: 'erstellte Löcher',
  },

  scorecard: {
    scopeOnly: (round: string) => `Nur Runde ${round}`,
    randomRound: 'Zufallsrunde',
    copyLink: 'Link zu diesem Platz kopieren',
    linkCopied: 'Link kopiert',
    courseCode: (code: string) => `Platz #${code}`,
    headerComplete: (round: string | null) =>
      round === null ? 'Scorekarte · Platz geschafft' : `Scorekarte · Runde ${round} geschafft`,
    courseComplete: (round: string | null) =>
      round === null ? 'Platz geschafft! ⛳' : `Runde ${round} geschafft! ⛳`,
    strokesPar: (strokes: number, par: number) => `${strokes} Schläge · Par ${par}`,
    strokesIn: 'Schläge in',
    vsPar: 'zu Par',
    playAgain: 'Noch mal ▸',
    clearToPlayAgain: 'räum das Brett ab für eine neue Runde',
    header: (round: string, hole: number, holes: number) =>
      `Scorekarte · ${round} · Loch ${hole}/${holes}`,
    qubitsClubs: (qubits: number, clubs: string) =>
      `${qubits} ${qubits === 1 ? 'Qubit' : 'Qubits'} · Schläger: ${clubs}`,
    target: 'Ziel',
    par: 'Par',
    strokes: 'Schläge',
    fidelity: 'Übereinstimmung',
    best: 'Bestwert',
    total: 'Gesamt',
    time: 'Zeit',
    wipe: 'Brett leeren (+1 Schlag)',
    nextHole: 'Nächstes Loch ▸',
    clearForNext: 'räum das Brett ab fürs nächste Loch',
    atLeast: (score: number) => `dieses Loch zählt mindestens ${score}`,
    hideSolution: 'Lösung ausblenden',
    showSolutionPrice: (price: number) => `Lösung zeigen (zählt doppeltes Par – ${price})`,
    stuck: 'Hängst du fest? Lösung zeigen',
    showSolution: 'Lösung zeigen',
    solutionOptimal: 'Lösung – optimal',
    dealtSolution: 'Ursprungslösung',
    solution: 'Lösung',
    optimal: (gates: number) => `Optimal (${gates} Gatter)`,
    allHoles: 'alle Löcher',
    chipTitle: (code: string, name: string, par: number) => `${code} · ${name} · Par ${par}`,
    chipTitleBest: (code: string, name: string, par: number, best: number, vsPar: string) =>
      `${code} · ${name} · Par ${par} · Bestwert ${best} (${vsPar})`,
    tapToPlay: ' – tippen zum Spielen',
    playHole: (hole: number, code: string) => `Loch ${hole} spielen, ${code}`,
    solutionCircuit: 'Lösungsschaltung',
  },

  challenge: {
    button: 'Mehrspieler',
    aria: 'Mehrspieler – diesen Platz teilen',
    title: 'QR-Code für diesen Platz zeigen',
    dialog: 'Mehrspieler – QR-Code für diesen Platz',
    hintFull: 'Scannen und denselben Platz spielen – dieselben 18 Löcher, dieselben Pars.',
    hintRound: (round: string) =>
      `Scannen und dieselbe Runde „${round}“ spielen – dieselben Löcher, dieselben Pars.`,
    code: (code: string, round: string | null) =>
      `Platz #${code}${round === null ? '' : ` · Runde ${round}`}`,
    subhint: 'Vergleicht Schläge und Zeit, wenn ihr beide fertig seid.',
    close: 'Schließen',
  },

  /**
   * The golf goal line, German. Same rule as English: vague is allowed, wrong is
   * not — every template is a true statement about the state it is chosen for.
   * Bodies are infinitive phrases after „Ziel:“ ("die Kugel … landen lassen").
   */
  goal: {
    sentence: (body: string, twist: string | null) =>
      twist === null ? `Ziel: ${body}.` : `Ziel: ${body}, dazu ${twist}.`,
    fallback: 'Ziel: den gezeigten Zielzustand nachbauen.',
    certainOne: 'die Kugel sicher auf 1 landen lassen – kipp sie um',
    certainZero: 'die Kugel sicher auf 0 landen lassen',
    certain: (balls: number, bits: string) => `${kugeln(balls)} sicher auf ${bits} landen lassen`,
    fairCoin: 'eine faire 50/50-Münze',
    // "always agree" = they always land the same way; kept short, because the
    // line is one ellipsized row under the sphere.
    agree: (balls: number) => `${kugeln(balls)} verschränken – sie landen immer gleich`,
    disagree: 'beide Kugeln verschränken – sie landen nie gleich',
    complement: (balls: number, a: string, b: string) =>
      `alle ${balls} Kugeln verschränken – immer ${a} oder ${b}, 50/50`,
    oneCoin: (a: string, b: string) =>
      `eine Kugel als faire 50/50-Münze, die anderen sicher – ${a} oder ${b}`,
    someEntangled: (entangled: number, balls: number, a: string, b: string) =>
      `${entangled} der ${balls} Kugeln verschränken – immer ${a} oder ${b}, 50/50`,
    allCoins: (balls: number) =>
      balls === 1
        ? 'die Kugel zu einer fairen 50/50-Münze machen'
        : `${kugeln(balls)} zu fairen 50/50-Münzen machen`,
    equallyLikely: (outcomes: number) => `${outcomes} Ergebnisse, alle gleich wahrscheinlich`,
    twist: {
      half: 'eine halbe Phasendrehung',
      quarter: 'eine Viertel-Phasendrehung',
      eighth: 'eine Achtel-Phasendrehung',
      threeEighths: 'eine Drei-Achtel-Phasendrehung',
      any: 'eine Phasendrehung',
    },
  },

  // --------------------------------------------------------- state displays
  evolving: {
    bloch: 'Bloch-Kugel',
    qsphere: 'Q-Kugel',
    state: 'Zustand',
    target: 'Ziel',
    stepsAria: 'Schritte der Zustandsentwicklung',
    replay: 'Animation wiederholen',
    prev: 'Vorheriger Schritt',
    next: 'Nächster Schritt',
    goTo: (step: string) => `Gehe zu: ${step}`,
    start: 'Start',
    afterLayer: (layer: number) => `nach Schicht ${layer}`,
    blochTitle: 'Projektion des Zustands auf die Bloch-Kugel',
    qsphereTitle: 'Projektion des Zustands auf die Q-Kugel',
    resetOrientation: 'Ausrichtung zurücksetzen',
    phaseLegend: 'Farblegende der Phase',
    ketAria: (label: string) => `${label} in Bra-Ket-Schreibweise`,
    ketAriaCurrent: 'Aktueller Zustand in Bra-Ket-Schreibweise',
  },

  histogram: {
    results: 'Ergebnisse',
    eightOutcomes: 'Ergebnisse · 8 Möglichkeiten',
    placeTile: 'Leg ein Plättchen, um Ergebnisse zu sehen',
    top: (shown: number) => `Ergebnisse · Top ${shown}`,
    outcomes: (n: number) => `Ergebnisse · ${n} Möglichkeiten`,
    topOf: (shown: number, of: number) => `Ergebnisse · Top ${shown} von ${of}`,
    shownOf: (shown: number, total: number) => `Ergebnisse · ${shown} von ${total} Möglichkeiten`,
    more: (n: number) => `+ ${n} weitere Ergebnisse`,
    moreEach: (n: number, pct: string) =>
      `+ ${n} weitere Ergebnisse mit je ≤ ${comma(pct)} %`,
    // Pocket passes no suffix ("… 32 gleich wahrscheinlich"), the kiosk one
    // ("… 32 gleich wahrscheinliche Möglichkeiten") — the adjective declines.
    uniform: (pct: string, total: number, suffix: string) =>
      suffix
        ? `alle Ergebnisse ≈ ${comma(pct)} % – ${total} gleich wahrscheinliche${suffix}`
        : `alle Ergebnisse ≈ ${comma(pct)} % – ${total} gleich wahrscheinlich`,
    possibilities: ' Möglichkeiten',
    ideal: 'ideal',
    withNoise: 'mit Rauschen',
  },

  statePanel: {
    label: 'Zustand',
    touched: 'Qubits benutzt',
    gates: 'Gatter',
    columns: 'Spalten',
  },

  // ------------------------------------------------- IBM Composer hand-off
  composer: {
    copied:
      'Der Composer ist mit deiner Schaltung geöffnet – melde dich (kostenlos) an, um sie auf einem echten Quantencomputer laufen zu lassen.',
    noCopy:
      'Der Composer ist mit deiner Schaltung geöffnet – melde dich (kostenlos) an, um sie auf echter Hardware laufen zu lassen.',
    signIn:
      'Nutzt alle 5 Qubits – melde dich bei IBM Quantum an, um sie dort zu simulieren (ohne Konto bis zu 4).',
    syncEnabled:
      'Composer-Tab geöffnet – er folgt dem Tisch. Melde dich (kostenlos) an, um auf echter Hardware zu rechnen.',
    transfer: 'An den IBM Composer senden',
    transferNote: 'Kopiert deine Schaltung und öffnet sie bei IBM Quantum.',
    live: 'Live-Composer',
    liveSyncing: 'Live-Composer · synchron',
    liveOnTitle: 'Der Composer-Tab folgt dem Tisch – tippen zum Stoppen',
    liveOffTitle: 'Einen Composer-Tab öffnen, der dem Tisch live folgt',
    qrAria: 'QR-Code für deine Schaltung zeigen',
    qrTitle: 'QR – öffne deine Schaltung im IBM Quantum Composer',
    qrDialog: 'QR-Code – öffne deine Schaltung im IBM Quantum Composer',
    close: 'Schließen',
    qrCaption:
      'Scanne, um DEINE Schaltung im IBM Quantum Composer zu öffnen – melde dich (kostenlos) an, um sie auf einem echten Quantencomputer laufen zu lassen',
    qrCaptionOverlong:
      'Diese Schaltung ist zu groß für einen QR-Code – öffne sie mit dem Senden-Knopf im IBM Quantum Composer (er kopiert den QASM-Code auch in deine Zwischenablage).',
    disclaimer: 'Unabhängiges Projekt – nicht mit IBM verbunden.',
    kioskLabel: 'Deine Schaltung → IBM Composer',
    kioskCaption:
      'Scanne, um diese Schaltung im IBM Quantum Composer zu öffnen – unabhängiges Projekt, nicht mit IBM verbunden.',
  },

  // ---------------------------------------------------------------- Quantina
  quantina: {
    scoops: 'Kugeln',
    shotsAria: 'Anzahl der Durchläufe',
    fewer: 'Weniger',
    more: 'Mehr',
    serve: 'Servieren',
    loadError: (error: string, fallback: string) =>
      `Dieses Menü ließ sich nicht laden (${error}) – zeige ${fallback}.`,
    youOrdered: 'Deine Bestellung',
    justTheGlass: 'nur das Glas',
    shotSource: {
      ideal: 'aus dem idealen Zustand gezogen',
      noisy: 'mit Hardware-Rauschen gezogen',
      real: 'auf echter Hardware gemessen',
    },
    realHardware:
      'Lieber von echter Hardware? Scanne den Schaltungs-QR, führ sie mit EINEM Durchlauf auf deinem eigenen Gerät aus und sag dem Team deinen Bitstring.',
    packs: {
      coffee: {
        tagline: 'Bestell deinen Kaffee mit einem Quantencomputer',
        items: {
          '000': 'Tee',
          '001': 'Heiße Schokolade',
          '011': 'Kaffee',
          '110': 'Wiener Melange',
        },
        subtitles: {},
      },
      cocktails: {
        tagline: 'Misch deinen Drink mit einem Quantencomputer',
        items: {
          '111': 'Wasser',
        },
        subtitles: {},
      },
      icecream: {
        tagline: 'Kugeln per Überlagerung',
        items: {
          '000': 'Erdbeere',
          '001': 'Zitrone',
          '010': 'Zitrone/Gurke',
          '100': 'Sesam',
          '101': 'Schokolade',
          '110': 'Gesalzene Erdnuss',
          '111': 'Geschmolzen :(',
        },
        subtitles: {
          '111': 'die ehrliche Antwort auf übrige Amplitude',
        },
      },
      juice: {
        tagline: 'Jedes gesetzte Bit landet in deinem Glas',
        items: {
          q0: 'Orangensaft',
          q2: 'Sprudelwasser',
        },
        subtitles: {
          q0: 'die sonnige Basis jedes Glases',
          q1: 'ein tropischer Spritzer, wenn sein Bit gesetzt ist',
          q2: 'das Prickeln – verschränk es, damit alles zusammen sprudelt',
        },
      },
      demo: {
        tagline: 'Das Doku- und Test-Paket mit vier Ergebnissen',
        items: {},
        subtitles: {},
      },
    },
  },

  // ---------------------------------------------------------- Quantum Runner
  runner: {
    score: 'Punkte',
    lives: (n: number) => `${n} Leben`,
    level: 'Level',
    oneQubit: '1 Qubit',
    twoQubits: '2 Qubits',
    gates: 'Gatter',
    gameOver: 'Spiel vorbei',
    overTitle: 'Die Messung hat dich erwischt',
    overFlavour:
      'Eine projektive Messung hat dich einmal zu oft in ein Hindernis kollabieren lassen.',
    distance: 'Strecke',
    meters: (m: number) => `${m} m`,
    runAgain: 'Noch mal laufen',
  },

  // ------------------------------------------------------------------ kiosk
  kiosk: {
    live: 'live',
    reconnecting: 'verbindet neu',
    offline: 'offline',
    disconnectedRetrying: 'Stand getrennt – neuer Versuch…',
    connecting: 'Verbinde mit dem Stand…',
    pendingHint:
      'Der große Bildschirm spiegelt den Stand. Warte, bis der Rechner am Stand online ist.',
    modes: {
      composer: 'Composer',
      golf: 'Golf',
      quantina: 'Quantina',
      attract: 'Pause',
    },
    iphoneCamera: 'iPhone-Kamera',
    viewers: (n: number) => `${n} schauen zu`,
    presentedAt: 'zu Gast bei',
    eventLogo: 'Logo der Veranstaltung',
    camera: 'Kamera',
    liveCamera: 'Live-Kamera des Stands',
    visitorQr: 'Scannen zum Mitverfolgen – und nimm deine Schaltung mit',
    attractLabel: (event: string | null) =>
      event === null
        ? 'Entangible – leg ein Plättchen auf den Tisch, um zu starten'
        : `Entangible bei ${event} – leg ein Plättchen auf den Tisch, um zu starten`,
    attractAt: 'bei',
    attractTaglines: [
      'Bau einen Quantenschaltkreis mit deinen Händen – leg ein Plättchen auf den Tisch',
      'Bestell deinen Kaffee mit einem Quantencomputer',
    ],
    attractSite: 'entangible.org · ein Fun-with-Quantum-Projekt',
    noisyRun: 'Mit Rauschen simulieren',
    noisyRunning: 'Läuft…',
    noisyIdeal: 'ideal',
    noisyNoisy: 'verrauscht',
    noisyIdealTitle: (pct: string) => `ideal ${comma(pct)} %`,
    noisyNoisyTitle: (pct: string) => `verrauscht ${comma(pct)} %`,
    noisyMessage: 'Echte Quantencomputer rauschen – sieh dir den Unterschied an',
  },

  // ------------------------------------------------------------------ guide
  guide: {
    back: 'Zurück',
    aria: 'Anleitung und Infos',
    navAria: 'Abschnitte der Anleitung',
    sectionAria: (title: string) => `${title} – Abschnitt der Anleitung`,
    sections: {
      start: { nav: 'Los geht’s', title: 'Los geht’s' },
      print: { nav: 'Kit drucken', title: 'Kit drucken' },
      play: { nav: 'Spielen', title: 'Spielen' },
      build: { nav: 'Am Bildschirm', title: 'Am Bildschirm bauen' },
      booth: { nav: 'Stand & Projekt', title: 'Stand und Projekt' },
    },
    testBoardAria: (title: string) => `Testbrett: ${title}`,
    prevBoard: 'Vorheriges Brett',
    nextBoard: 'Nächstes Brett',
    close: 'Schließen',
    testBoards: {
      '01-empty': { title: 'Leeres Brett', blurb: 'Nur die Ecken – erwarte eine leere Schaltung.' },
      '02-single-h': {
        title: 'H auf q0',
        blurb: 'Ein einzelnes Hadamard – ein Qubit in Überlagerung.',
      },
      '03-bell': {
        title: 'Bell-Paar',
        blurb: 'H, dann CNOT – erwarte die Verschränkungs-Feier.',
      },
      '04-ghz3': {
        title: 'GHZ-3',
        blurb: 'Eine CNOT-Kette – wiederholte ●/⊕-IDs testen das räumliche Entdoppeln.',
      },
      '05-ghz5': {
        title: 'GHZ-5',
        blurb: 'CNOT-Treppe über die volle Höhe – Golf-Loch 5.',
      },
      '06-all-families': {
        title: 'Jede Gatter-Familie',
        blurb: 'Von jeder eins, auch S/T und Rotationen.',
      },
      '07-uniform-32': {
        title: 'H auf allen fünf Qubits',
        blurb: '32 gleich wahrscheinliche Ergebnisse – ein Härtetest fürs Histogramm.',
      },
      '08-lone-control': {
        title: 'Einsame Steuerung',
        blurb: 'Ein ● ohne ⊕-Partner – eine freundliche Warnung, kein CNOT.',
      },
      '09-dials': {
        title: 'Drehplättchen',
        blurb: 'RX/RY/RZ-Drehregler – die Drehung des Plättchens wählt den Winkel.',
      },
      '10-swap': {
        title: 'SWAP-Plättchen',
        blurb: 'Zwei ×-Plättchen in einer Spalte tauschen die Qubits – ausgegeben als drei CNOTs.',
      },
    },
  },
};

export default de;
