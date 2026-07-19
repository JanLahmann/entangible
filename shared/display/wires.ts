/**
 * Shared display-only "wire count" vocabulary for both Entangible apps.
 *
 * The kiosk booth skin and the pocket surfaces both offer a wires
 * setting that decides how many qubit wires the controlled `CircuitEditor`
 * draws (and, on the booth, how many rows the histogram spans). The underlying
 * recognized circuit is ALWAYS five physical qubits — this vocabulary is
 * display-only and never touches gate data, detection, the statevector,
 * moments or QASM.
 *
 *   - 'all'     → always the full 5 wires.
 *   - 'compact' → the smallest count that still covers every used row.
 *
 * Historically each app defined its own `Wires` union (display: `ws/messages`,
 * pocket: `settings`). SC1 gives them one home so the two stay in lockstep; the
 * old locations re-export from here.
 */
export type Wires = 'compact' | 'all';
