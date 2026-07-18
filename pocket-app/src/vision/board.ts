/**
 * Board detection: homography from the four corner markers (IDs 0-3).
 *
 * Port of `board.py`. Each detected corner marker contributes 4 point
 * correspondences (image px ↔ board mm, from `cornerMarkerSquare`); we fit a
 * projective homography image-px → board-mm by normalized DLT (Hartley
 * normalization + smallest right-singular-vector of A, found via a Jacobi
 * eigen-decomposition of AᵀA). Returns null when fewer than 3 corner markers
 * are visible.
 *
 * No OpenCV / WASM — plain arithmetic, matching the hand-rolled detector.
 */
import {
  BOARD,
  CORNER_IDS,
  CORNER_ROLES,
  MIN_CORNERS_FOR_BOARD,
  cornerMarkerSquare,
  type Point,
} from './geometry';
import type { DetectedMarker } from './detect';

export type Mat3 = number[]; // row-major 3×3 (length 9)

export interface BoardResult {
  /** 3×3 homography mapping image px → board mm. */
  readonly homography: Mat3;
  /** RMS reprojection error of the correspondences, in mm. */
  readonly reprojectionError: number;
  /** Corner marker IDs found and used (subset of {0,1,2,3}), canonical order. */
  readonly cornerIds: number[];
  imageToBoard(px: Point): [number, number];
  boardToImage(mm: Point): [number, number];
}

// ---------------------------------------------------------------------------
// Small linear algebra
// ---------------------------------------------------------------------------

function matMul3(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[r * 3 + k] * b[k * 3 + c];
      out[r * 3 + c] = s;
    }
  }
  return out;
}

function applyHomography(h: Mat3, x: number, y: number): [number, number] {
  const u = h[0] * x + h[1] * y + h[2];
  const v = h[3] * x + h[4] * y + h[5];
  const w = h[6] * x + h[7] * y + h[8];
  return [u / w, v / w];
}

function invert3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-18) throw new Error('singular homography');
  const invDet = 1 / det;
  return [
    A * invDet,
    (c * h - b * i) * invDet,
    (b * f - c * e) * invDet,
    B * invDet,
    (a * i - c * g) * invDet,
    (c * d - a * f) * invDet,
    C * invDet,
    (b * g - a * h) * invDet,
    (a * e - b * d) * invDet,
  ];
}

/**
 * Eigenvector of a symmetric N×N matrix with the smallest eigenvalue, via the
 * cyclic Jacobi method (robust for the small 9×9 here). Returns the column of
 * the accumulated rotation matrix at the smallest diagonal entry.
 */
function smallestEigenvector(mIn: number[][]): number[] {
  const n = mIn.length;
  const a = mIn.map((row) => [...row]);
  const v: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );

  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    if (off < 1e-24) break;

    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const app = a[p][p];
        const aqq = a[q][q];
        const apq = a[p][q];
        const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
        const c = Math.cos(phi);
        const s = Math.sin(phi);
        for (let k = 0; k < n; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }

  let minIdx = 0;
  for (let i = 1; i < n; i++) if (a[i][i] < a[minIdx][minIdx]) minIdx = i;
  return v.map((row) => row[minIdx]);
}

/** Hartley normalization: translate to centroid, scale so mean dist = √2. */
function normalization(points: Array<[number, number]>): { T: Mat3 } {
  const n = points.length;
  let cx = 0;
  let cy = 0;
  for (const [x, y] of points) {
    cx += x;
    cy += y;
  }
  cx /= n;
  cy /= n;
  let meanDist = 0;
  for (const [x, y] of points) meanDist += Math.hypot(x - cx, y - cy);
  meanDist /= n;
  const scale = meanDist > 0 ? Math.SQRT2 / meanDist : 1;
  // T = scale * [[1,0,-cx],[0,1,-cy]] with 1 in bottom-right.
  return { T: [scale, 0, -scale * cx, 0, scale, -scale * cy, 0, 0, 1] };
}

/** Normalized-DLT homography mapping src → dst (least squares over all pairs). */
export function findHomography(
  src: Array<[number, number]>,
  dst: Array<[number, number]>,
): Mat3 {
  const { T: Ts } = normalization(src);
  const { T: Td } = normalization(dst);

  const srcN = src.map(([x, y]) => applyHomography(Ts, x, y));
  const dstN = dst.map(([x, y]) => applyHomography(Td, x, y));

  // Build A (2N × 9) for src → dst.
  const A: number[][] = [];
  for (let i = 0; i < srcN.length; i++) {
    const [x, y] = srcN[i];
    const [u, v] = dstN[i];
    A.push([-x, -y, -1, 0, 0, 0, u * x, u * y, u]);
    A.push([0, 0, 0, -x, -y, -1, v * x, v * y, v]);
  }

  // AᵀA (9×9 symmetric).
  const ata: number[][] = Array.from({ length: 9 }, () => new Array<number>(9).fill(0));
  for (const row of A) {
    for (let i = 0; i < 9; i++) {
      for (let j = i; j < 9; j++) {
        ata[i][j] += row[i] * row[j];
      }
    }
  }
  for (let i = 0; i < 9; i++) for (let j = 0; j < i; j++) ata[i][j] = ata[j][i];

  const h = smallestEigenvector(ata);
  const Hn: Mat3 = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], h[8]];

  // Denormalize: H = Td⁻¹ · Hn · Ts.
  let H = matMul3(invert3(Td), matMul3(Hn, Ts));
  // Normalize so H[8] = 1 (matches OpenCV's convention).
  if (Math.abs(H[8]) > 1e-18) H = H.map((x) => x / H[8]);
  return H;
}

// ---------------------------------------------------------------------------
// Board fitting
// ---------------------------------------------------------------------------

export function fitBoard(markers: DetectedMarker[]): BoardResult | null {
  const srcPx: Array<[number, number]> = [];
  const dstMm: Array<[number, number]> = [];
  const found: number[] = [];

  for (const marker of markers) {
    if (!(String(marker.id) in CORNER_IDS)) continue;
    found.push(marker.id);
    const square = cornerMarkerSquare(marker.id);
    for (let k = 0; k < 4; k++) {
      const px = marker.corners[k];
      const mm: Point = square[k];
      srcPx.push([px[0], px[1]]);
      dstMm.push([mm[0], mm[1]]);
    }
  }

  if (found.length < MIN_CORNERS_FOR_BOARD) return null;

  let homography: Mat3;
  try {
    homography = findHomography(srcPx, dstMm);
  } catch {
    return null;
  }

  // RMS reprojection error, in mm.
  let sumSq = 0;
  for (let i = 0; i < srcPx.length; i++) {
    const [u, v] = applyHomography(homography, srcPx[i][0], srcPx[i][1]);
    const dx = u - dstMm[i][0];
    const dy = v - dstMm[i][1];
    sumSq += dx * dx + dy * dy;
  }
  const rms = Math.sqrt(sumSq / srcPx.length);

  // Order corner ids by canonical role (TL, TR, BR, BL) for stability.
  const roleOrder = new Map(CORNER_ROLES.map((role, idx) => [role, idx]));
  const ordered = [...found].sort(
    (a, b) => roleOrder.get(CORNER_IDS[String(a)])! - roleOrder.get(CORNER_IDS[String(b)])!,
  );

  const inv = invert3(homography);
  return {
    homography,
    reprojectionError: rms,
    cornerIds: ordered,
    imageToBoard: (px: Point) => applyHomography(homography, px[0], px[1]),
    boardToImage: (mm: Point) => applyHomography(inv, mm[0], mm[1]),
  };
}

export { BOARD };
