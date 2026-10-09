/**
 * The Guide's prose in English — the source the German (`./de.tsx`) mirrors.
 * Styling is pk-token, dark, restrained; the copy voice is plain and warm.
 */
import type { GuideProse } from './types';
import { Ext, Label } from './parts';
import {
  BOARD_PDF_URL,
  COMPOSER_URL,
  FAMILY_URL,
  IBM_REGISTRATION_URL,
  ISSUES_URL,
  LASER_KIT_URL,
  QAMPOSER_URL,
  REPO_URL,
  TILES_3D_URL,
  cubeFamily,
  kitPdf,
} from './links';

export const guideEn: GuideProse = {
  start: ({ sectionLink }) => (
    <>
      {/* What is this */}
      <section className="pk-guide-sec">
        <Label>What is this</Label>
        <p>
          Entangible is a quantum circuit composer you operate with your hands: physical gate
          tiles on a printed board, read by a camera, simulated live. This pocket app is the
          zero-install edition — everything runs right here in your browser; no server, no
          account, nothing leaves your device. Entangible is built on{' '}
          <Ext href={QAMPOSER_URL}>QAMPoser</Ext>, the open-source quantum composer, and belongs
          to the <Ext href={FAMILY_URL}>Fun with Quantum</Ext> family.
        </p>
        <p className="pk-guide-muted">
          The name is a pun: <b>entangled + tangible = Entangible.</b>
        </p>
      </section>

      {/* How to use it */}
      <section className="pk-guide-sec">
        <Label>How to use it</Label>
        <ol className="pk-guide-steps">
          <li>
            Print the kit (or use the <a {...sectionLink('booth')}>on-screen boards</a>).
          </li>
          <li>
            Start the camera and point it at the board from 30–60 cm, with all four corner markers
            in view.
          </li>
          <li>
            Place tiles — the circuit, outcomes and QASM follow live. A <b>●</b> and a <b>⊕</b> in
            one column make a CNOT; a <b>●</b> next to any gate makes its controlled version (● +{' '}
            <b>H</b> = controlled-H, two <b>●</b> + <b>X</b> = Toffoli).
          </li>
          <li>Build a Bell pair for a surprise.</li>
        </ol>
        <p>
          No printed mat? Four <b>corner blocks</b> mark the board instead, and they may span{' '}
          <b>any rectangle</b> — the camera measures it from the blocks themselves. Settings →{' '}
          <b>Board</b> decides what a bigger table buys: <b>More columns</b> (the default) keeps the
          tile pitch and adds columns; <b>Bigger cells</b> stretches the same eight columns to fill
          it. Lay <b>qubit-wire blocks</b> down the left edge and each one is a wire, so the
          circuit has exactly as many qubits as you put down — none means the classic five.{' '}
          <b>Measurement blocks</b> go down the right edge, level with them: state prep on the
          left, measurement on the right, just like a circuit diagram. They are optional and never
          add a wire; they just tell the camera where each one ends.
        </p>
        <p className="pk-guide-muted pk-guide-tips">
          Tips: pinch to zoom; the gear opens settings, including golf mode and a debug view; matte
          print beats glossy; screens work as boards. On a Mac, your iPhone can be the camera via
          Continuity — pick it under Settings → Camera.
        </p>
      </section>

      {/* Run it for real */}
      <section className="pk-guide-sec">
        <Label>Run it for real</Label>
        <p>
          Built something you like? The <b>Transfer to IBM Composer</b> button opens the IBM
          Quantum Composer in a new tab with your circuit pre-loaded (the QASM is also copied to
          your clipboard — paste via <b>View → Code Editor</b> if ever needed). To run it on a real
          quantum computer, sign in — or register for free at{' '}
          <Ext href={IBM_REGISTRATION_URL}>quantum.cloud.ibm.com/registration</Ext>. A free IBM
          Quantum account (the Open Plan) then lets you run it on real hardware.
        </p>
        <p>
          On another device? The <b>QR</b> button beside Transfer shows a code that opens the same
          pre-loaded Composer on your phone — scan it and your circuit is there, no typing.
        </p>
        <p>
          Curious why real quantum computers get different answers? Flip <b>Noise</b> on in
          Settings to overlay the results with a simulated-noise series and watch the same circuit
          behave the way it would on real hardware. The presets walk through four real IBM chip
          generations — Falcon (2021), Eagle, Heron and Nighthawk — with parameters taken from
          device calibration snapshots, so you can see, literally, how the hardware has improved.
        </p>
      </section>
    </>
  ),

  print: () => (
    <>
      {/* Print the real kit */}
      <section className="pk-guide-sec">
        <Label>Print the real kit</Label>
        <p>
          One PDF, 12 × A4: the 32-tile booth kit on three sheets, the board mat on nine. Print at
          100 % — never "fit to page" — on matte paper; each sheet carries a 100 mm check ruler.
        </p>
        <a
          className="pk-guide-download"
          href={kitPdf}
          download="entangible-print-kit-A4.pdf"
          target="_blank"
          rel="noopener noreferrer"
        >
          Download the print kit (PDF)
        </a>
        <p className="pk-guide-muted">
          For print shops, a full-size single-sheet board (720 × 500 mm) is in the release
          downloads: <Ext href={BOARD_PDF_URL}>entangible-board-720x500.pdf</Ext>.
        </p>
      </section>

      {/* 3D-print the tiles */}
      <section className="pk-guide-sec">
        <Label>3D-print the tiles</Label>
        <p>
          For multi-material printers (Prusa MMU, Bambu AMS): every gate as a colored 3MF — white
          body, black marker, gate-colored band — as flat tiles (6 mm), chunky cubes (60 mm,
          hollow, gate letters on all four sides so you can read a piece from across the table),
          and <b>double-faced flip pieces</b>: two gates per piece, one flip apart (flip H to get
          X; flip a rotation to get its inverse). Open a 3MF in your slicer — every part is already
          on its filament slot. Use matte filament — glossy tops glare and hurt detection.
        </p>
        <img
          className="pk-guide-render"
          src={cubeFamily}
          alt="Isometric rendering of the Entangible gate cubes: H, X, Y, Z, CNOT control and target, RX(π/2), S and T"
          loading="lazy"
        />
        <p>
          The zip holds one folder per variant — <b>tile</b>, <b>cube</b>, <b>tile-double</b>,{' '}
          <b>cube-double</b> — each with its pieces, a <b>plates.md</b> naming the filament colors
          slot by slot, and a <b>mono.md</b> for single-color printing. Alongside them,{' '}
          <b>print-jobs</b> has ready-to-slice bed layouts, up to 8 pieces pre-arranged per job
          (250×220 bed, room left for the wipe tower), so a whole kit is a handful of
          open-slice-print files.
        </p>
        <a className="pk-guide-download" href={TILES_3D_URL} target="_blank" rel="noopener noreferrer">
          Download the 3D tiles (3MF + STL, ZIP)
        </a>
        <p className="pk-guide-muted">
          Rotation-gate variants carry tactile notches (1–4 = π/4, π/2, π, −π/2). Cubes prefer a
          straight-overhead camera — their height parallax-shifts the face at steep angles.
        </p>
      </section>

      {/* One filament only */}
      <section className="pk-guide-sec">
        <Label>One filament only</Label>
        <p>
          No MMU? The same zip carries every piece twice more, as plain STLs.{' '}
          <b>*-mono-recessed.stl</b> sinks each colored region 0.5 mm into the face as a paint well
          with vertical walls: print it white, then fill the wells with acrylic paint pens — the
          surrounding rim masks the paint edge. Only the black marker really has to be painted;
          the gate glyph already says which gate it is. <b>*-mono-raised.stl</b> does the
          opposite, standing the art proud of the face so a single filament swap at the accent
          layer gives you a two-tone piece on any printer. Each variant's <b>mono.md</b> has the
          recipe: which color belongs where, and the exact Z height for the color change. The{' '}
          <b>print-jobs</b> folders carry mono beds too — <b>mono-recessed-batch*.3mf</b> and{' '}
          <b>mono-raised-batch*.3mf</b> — so one filament swap covers a whole plate at once.
        </p>
      </section>

      {/* Black and white — two filaments */}
      <section className="pk-guide-sec">
        <Label>Black and white only</Label>
        <p>
          Two filaments and no MMU? The same zip carries the whole kit a third way:{' '}
          <b>*-bw.3mf</b> per piece and <b>bw-batch*.3mf</b> beds, every part in plain white and
          black. The gate colors all collapse onto the marker's black, the band caption stays
          legible because it is cut out of the band and stands white inside it, and nothing the
          camera reads changes — it never looks at color. With no accent slots to group by, the
          kit packs straight onto beds: one bed set instead of one per color group. You lose color
          as a sorting cue; a dual-extruder printer or an AMS with two spools loaded is all it
          takes.
        </p>
      </section>

      {/* Corner blocks */}
      <section className="pk-guide-sec">
        <Label>No mat? Corner blocks</Label>
        <p>
          Four optional blocks — <b>UL</b>, <b>UR</b>, <b>LL</b>, <b>LR</b> — replace the printed
          board mat: each carries one of the mat's corner markers, so laid out on any table they
          give the camera exactly the four fiducials it expects. The left pair marks where the
          circuit starts. Orientation matters (a turned block skews the whole board), so the
          marker sits visibly off-center toward the outside and the label reads upright when the
          block is placed correctly. They print from the same 3D zip (<b>ul</b>/<b>ur</b>/
          <b>ll</b>/<b>lr</b> pieces + <b>corners.md</b> with placement rules) and cut from the
          laser kit alike.
        </p>
        <p>
          The four blocks may span <b>any rectangle</b> — they do not have to sit at the printed
          mat's spacing. The camera measures the rectangle from the blocks themselves (the 40 mm
          marker gives it the scale), so a bigger table simply means a bigger board. What a bigger
          board buys you is the <b>Board</b> setting: <b>More columns</b> (the default) keeps the
          tile pitch and hands you extra columns to build longer circuits; <b>Bigger cells</b>{' '}
          stretches the same eight columns across the whole table, which is easier to aim at from
          across a room. A mat-sized layout ignores the switch and behaves exactly as the printed
          mat always has. Add <b>qubit-wire blocks</b> down the left edge — up to five identical
          pieces between UL and LL — and each one declares a wire at its own height: three blocks
          is a three-qubit circuit, and gate tiles snap to the nearest wire. No wire blocks means
          the classic five. Facing them across the table, between UR and LR, go the{' '}
          <b>measurement blocks</b> — the same piece mirrored, with a little gauge instead of the{' '}
          <i>q</i>. They are pure polish: a wire exists because its left block does, and a
          measurement block only says where that wire ends, so the camera can run it as a straight
          line between the two and follow your tiles even when the two rows of blocks are not
          quite square. Lay none and nothing changes; a measurement block with no wire block
          across from it is simply ignored.
        </p>
      </section>

      {/* Laser-cut wood */}
      <section className="pk-guide-sec">
        <Label>Laser-cut wood tiles</Label>
        <p>
          Access to a laser cutter? The wood kit is the same 60 mm tiles as SVGs in the standard
          shop convention: pure red is a through-cut (the outline), pure black is an engrave (the
          marker's dark modules, the gate glyph, a border score). Nothing else — the bare wood is
          the marker's "white", so leave the marker field unengraved and unpainted. Tiles come
          grid-nested onto full sheets for a laser bed plus one SVG per gate for one-offs, and a
          plain-text shop README with material and kerf notes. The cut paths are drawn at nominal
          size, so set your kerf offset in the cutter software — or regenerate the kit with --kerf
          to have every outline outset by half the kerf. Birch or maple ply, matte, no lacquer.
        </p>
        <a className="pk-guide-download" href={LASER_KIT_URL} target="_blank" rel="noopener noreferrer">
          Download the laser kit (SVG, ZIP)
        </a>
        <p className="pk-guide-muted">
          Engrave one H tile first and check this app detects it before cutting the whole kit —
          plies vary, and contrast is everything.
        </p>
      </section>
    </>
  ),

  play: ({ sectionLink }) => (
    <>
      {/* Quantum Golf */}
      <section className="pk-guide-sec">
        <Label>Quantum Golf — eighteen holes</Label>
        <p>
          Switch <b>Settings → Mode → Golf</b> and each hole hands you a state to build. Eighteen
          holes in four rounds, and every round unlocks new clubs <i>and</i> a new idea:{' '}
          <b>Easy</b> plays with X, H and CX (superposition, Bell, GHZ); <b>Medium</b> adds{' '}
          <b>Y</b> and, with it, minus signs; <b>Difficult</b> adds <b>Z</b> and <b>S</b> for
          imaginary phases; <b>Extra</b> adds <b>T</b> and <b>controlled-H</b>, for eighth-turn
          phases and uneven splits.
        </p>
        <p>
          Every gate you add <i>or</i> remove counts a stroke, so a wrong tile costs you like a
          wrong swing. Par carries a two-stroke margin: build the hole in the fewest gates and you
          score an <b>EAGLE</b>, one gate more is a <b>BIRDIE</b>. The chip strip at the bottom of
          the scorecard keeps every hole's result next to its par.
        </p>
        <p>
          <b>New random 18</b> deals a fresh course. The targets are generated, but the difficulty
          rules make sure each round still plays like its name — a medium hole really does need Y,
          an extra hole really does need T or controlled-H. Every random course carries a code (
          <b>Course #…</b>): tap it to copy a link, or type a code into{' '}
          <b>Settings → Golf course code</b>. The same code deals the same eighteen holes on any
          phone — play a friend.
        </p>
        <p>
          Stuck? <b>Show solution</b> draws a short circuit that builds the target. It is offered
          once you hole in, and also mid-hole once you are a few strokes over par or a minute in.
          In the background the app searches for anything shorter: if it finds one it draws that
          too, and if it can prove there is nothing shorter it labels the drawing{' '}
          <b>Solution — optimal</b>.
        </p>
        <p className="pk-guide-muted">
          The sphere names itself — a <b>Bloch sphere</b> on one-qubit holes, a <b>Q-sphere</b>{' '}
          above. It always opens with |0…0⟩ at the top; drag to turn it (it follows your finger)
          and the rewind arrow puts it back. The goal is drawn on it as dashed rings with phase
          ticks, and the states that matter carry their ket label. Balls of probability roll
          across the surface as your circuit plays, splitting when a gate makes a superposition (
          <b>↻</b> replays). Below, the <b>State</b> and <b>Target</b> lines write the same thing
          as math, and target terms you have not matched yet glow.
        </p>
        <p className="pk-guide-muted">
          No printed tiles to hand? Golf plays just as well{' '}
          <a {...sectionLink('build')}>on screen</a>.
        </p>
      </section>

      {/* Quantina */}
      <section className="pk-guide-sec">
        <Label>Quantina — a quantum cantina</Label>
        <p>
          The built-in successor to Qoffee-Maker and quantum-mixer: switch{' '}
          <b>Settings → Mode → Quantina</b> and the histogram becomes a menu — your circuit's
          probabilities set the odds, a measurement picks your drink. Try{' '}
          <a href="/?menu=cocktails">entangible.org/?menu=cocktails</a>: one H per wire makes every
          cocktail equally likely; entangle two qubits and watch items start winning together.
        </p>
        <p className="pk-guide-muted">
          Five menus ship built-in (coffee, cocktails, ice cream, juice, diner). Booths can add
          their own menus — and even wire the winning outcome to a real coffee machine — see the
          repository docs.
        </p>
      </section>

      {/* Quantum Runner */}
      <section className="pk-guide-sec">
        <Label>Quantum Runner — dodge the measurement</Label>
        <p>
          Switch <b>Settings → Mode → Quantum Runner</b> for a Flappy-style game where the runner
          exists in every basis state at once — each lane's ghost is as solid as its probability.
          Tap the gate buttons to reshape the live state as coins and obstacles scroll in. Coins
          bank the <i>expected</i> value (never measured, so a superposition banks fractions); a
          red obstacle triggers a real projective measurement — collapse into it and you lose a
          life. On level 2, an obstacle straddling <b>|01⟩</b> and <b>|10⟩</b> can't touch the Φ⁺
          Bell state (H₀ then CX) — build it and sail through.
        </p>
        <p className="pk-guide-muted">
          Based on Quantum Runner by the QAMPoser project. No hardware needed — it plays entirely
          on screen.
        </p>
      </section>
    </>
  ),

  build: ({ sectionLink }) => (
    <section className="pk-guide-sec">
      <Label>Build on screen — no printer, no camera</Label>
      <p>
        Choose <b>Build on screen</b> (Settings → Input, or the button on the start screen) to
        place gates directly in the editor — play <a {...sectionLink('play')}>Quantum Golf</a> and
        transfer to the Composer, all with no hardware at all. In golf the on-screen palette hands
        you only the current round's clubs; outside golf you get the full gate set.
      </p>
      <p>
        On a touchscreen you don't have to drag: <b>tap a gate tile to arm it</b>, then tap a wire
        to place it there. For a controlled gate, tap the <b>control</b> wire first and then the{' '}
        <b>target</b> (for a Toffoli: two controls, then the target) — a line above the circuit
        says which tap is expected next. Tapping the armed tile again, or pressing Escape, cancels.
        Tap a gate already on a wire for its small toolbar: the pencil edits it (rotation angles
        and the wires of a controlled gate), the bin deletes it. Dragging still works everywhere.
      </p>
      <p className="pk-guide-muted">
        Have a screen to spare but no printer? The{' '}
        <a {...sectionLink('booth')}>on-screen test boards</a> let a second device play the part of
        the printed mat.
      </p>
    </section>
  ),

  booth: ({ sectionLink, testBoards, family }) => (
    <>
      {/* Test without a printer */}
      <section className="pk-guide-sec">
        <Label>Test without a printer</Label>
        {testBoards}
        <p className="pk-guide-muted">
          Show these fullscreen on one device, point another device's camera at it. Flip images to
          "move" tiles. No printer <i>and</i> no camera? Build the circuit{' '}
          <a {...sectionLink('build')}>on screen</a> instead.
        </p>
      </section>

      {/* The full project */}
      <section className="pk-guide-sec">
        <Label>The full project</Label>
        <p>
          This same app also runs the full booth installation: a Raspberry Pi kiosk (RasQberry)
          with a large screen shows it in kiosk mode, a live camera rig or a staff phone feeds it,
          and celebrations light up when entanglement appears — built for fairs and events. One
          app, same tiles, same board, same engine.
        </p>
        <p>
          At a booth, scan the <b>visitor QR</b> on the big screen to follow along on your own
          phone — you'll see the circuit being built on the table, live, and can take it home with
          the Transfer button.
        </p>
        <p>
          Booth tables are rarely mat-sized, so staff lay the corner blocks to whatever rectangle
          the table gives them and set <b>Board</b> once from the operator controls; the choice is
          broadcast, so every screen in the room reads the table the same way. Qubit-wire blocks
          along the left edge set how many qubits the board plays — handy for a short demo on two
          or three wires — and the matching measurement blocks on the right edge make the table
          read like a circuit diagram end to end. They are optional; on a table that is a little
          out of square they also let the camera follow each wire from its own block to its own
          measurement, which keeps tiles on the row you meant.
        </p>
        <ul className="pk-guide-links">
          <li>
            <Ext href={REPO_URL}>GitHub repository</Ext>
          </li>
          <li>
            <Ext href={ISSUES_URL}>Report an issue</Ext>
          </li>
        </ul>
      </section>

      {/* Family */}
      <section className="pk-guide-sec">
        <Label>Part of the Fun with Quantum family</Label>
        <p>
          Entangible belongs to{' '}
          <Ext href={FAMILY_URL}>
            <b>Fun with Quantum</b>
          </Ext>
          , a family of open-source quantum outreach projects: {family}.
        </p>
      </section>
    </>
  ),

  footer: () => (
    <>
      <p>
        Open source, Apache-2.0 licensed. Based on <Ext href={QAMPOSER_URL}>QAMPoser</Ext>. Part of
        the <Ext href={FAMILY_URL}>Fun with Quantum family</Ext>.
      </p>
      <p>
        Entangible is an independent community project inspired by the{' '}
        <Ext href={COMPOSER_URL}>IBM Quantum Composer</Ext>. It is not affiliated with, endorsed
        by, or sponsored by IBM. IBM, IBM Quantum and Qiskit are trademarks of International
        Business Machines Corporation.
      </p>
    </>
  ),
};
