/**
 * AttractMode — the idle screensaver loop (docs/booth-ux.md → Attract mode).
 *
 * Pure CSS animations only (no canvas, no libraries): a slow ~12 s loop that
 * shows the wordmark, a ghost H tile sliding onto a drawn mini-board, a ghost
 * ●⊕ pair with a spark of mini-confetti, and a 48 px call to action — all at
 * ≤ 30 % brightness. The whole thing is mounted only while attract is active;
 * the parent unmounts it on any activity, which is the "< 100 ms instant cut"
 * exit (React removes it synchronously on the next paint).
 */

const MINI_CONFETTI = ['#fa4d56', '#002d9c', '#9f1853', '#33b1ff'];

export function AttractMode() {
  return (
    <div className="ent-attract" role="img" aria-label="Entangible — place a tile on the table to begin">
      <div className="ent-attract__stage">
        <div className="ent-attract__wordmark">Entangible</div>

        <div className="ent-attract__board">
          {/* five drawn qubit wires */}
          {[0, 1, 2, 3, 4].map((q) => (
            <div className="ent-attract__wire" key={q} />
          ))}

          {/* ghost H tile that slides in and "lands" as a gate */}
          <div className="ent-attract__tile ent-attract__tile--h">H</div>

          {/* ghost control/target pair on the lower wires */}
          <div className="ent-attract__cnot">
            <span className="ent-attract__control">●</span>
            <span className="ent-attract__link" />
            <span className="ent-attract__target">⊕</span>
          </div>

          {/* mini confetti spark */}
          <div className="ent-attract__confetti">
            {MINI_CONFETTI.map((c, i) => (
              <span key={i} style={{ background: c }} className={`ent-attract__spark ent-attract__spark--${i}`} />
            ))}
          </div>
        </div>

        <div className="ent-attract__cta">
          Build a quantum circuit with your hands — place a tile on the table
        </div>
      </div>
    </div>
  );
}

export default AttractMode;
