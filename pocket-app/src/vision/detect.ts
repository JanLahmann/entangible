/**
 * Hand-rolled DICT_4X4_50 marker detector (js-aruco2-style, no WASM / OpenCV).
 *
 * Pipeline (docs/pocket.md): grayscale → adaptive threshold → contour trace →
 * polygon approx to quads → perspective-sample a 6×6 grid → border check →
 * dictionary match (Hamming ≤ 1 over all four rotations). Matched over the ~24
 * codes we actually use, from the generated `dictionary.json` (same cv2 source
 * as print + Python detection — asserted by the parity test).
 */
import dictionaryJson from './dictionary.json';

export interface GrayImage {
  readonly data: Uint8Array; // one byte per pixel, 0 = black … 255 = white
  readonly width: number;
  readonly height: number;
}

export interface RgbaImage {
  readonly data: Uint8Array | Uint8ClampedArray; // RGBA, 4 bytes per pixel
  readonly width: number;
  readonly height: number;
}

export type Corner = readonly [number, number];

export interface DetectedMarker {
  readonly id: number;
  /** 90°-CW turns of the marker in the image relative to its canonical print. */
  readonly rotation: number;
  /** Four image-px corners; canonical order (TL, TR, BR, BL) for an upright marker. */
  readonly corners: [Corner, Corner, Corner, Corner];
  readonly center: [number, number];
}

// ---------------------------------------------------------------------------
// Dictionary (packed rotation codes) loaded once.
// ---------------------------------------------------------------------------

interface DictEntry {
  id: number;
  rotations: number[];
}

const DICT: DictEntry[] = Object.entries(
  dictionaryJson.markers as Record<string, { rotations: number[] }>,
).map(([id, entry]) => ({ id: Number(id), rotations: entry.rotations }));

const GRID = 6; // 4 inner modules + 1 border on each side

function popcount(x: number): number {
  let n = 0;
  while (x) {
    x &= x - 1;
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Grayscale + adaptive threshold
// ---------------------------------------------------------------------------

export function toGray(image: RgbaImage): GrayImage {
  const { data, width, height } = image;
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    // Rec. 601 luma.
    gray[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
  }
  return { data: gray, width, height };
}

/**
 * Adaptive mean threshold via an integral image: pixel is "dark" (1) when it is
 * more than `c` below the mean of a `window`×`window` neighbourhood. Robust to
 * uneven lighting on a phone/tablet camera.
 */
export function adaptiveThreshold(gray: GrayImage, window = 21, c = 7): Uint8Array {
  const { data, width, height } = gray;
  const integral = new Float64Array((width + 1) * (height + 1));
  const iw = width + 1;
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += data[y * width + x];
      integral[(y + 1) * iw + (x + 1)] = integral[y * iw + (x + 1)] + rowSum;
    }
  }
  const half = window >> 1;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(height - 1, y + half);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(width - 1, x + half);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        integral[(y1 + 1) * iw + (x1 + 1)] -
        integral[y0 * iw + (x1 + 1)] -
        integral[(y1 + 1) * iw + x0] +
        integral[y0 * iw + x0];
      const mean = sum / area;
      out[y * width + x] = data[y * width + x] < mean - c ? 1 : 0;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Contour tracing (Moore neighbour) + polygon approximation
// ---------------------------------------------------------------------------

type Pt = [number, number];

// 8-neighbourhood offsets in clockwise order (NW, N, NE, E, SE, S, SW, W).
const NEIGHBOURS: ReadonlyArray<Pt> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
];

function traceContours(bin: Uint8Array, width: number, height: number): Pt[][] {
  const visited = new Uint8Array(width * height);
  const contours: Pt[][] = [];
  const at = (x: number, y: number): number =>
    x >= 0 && y >= 0 && x < width && y < height ? bin[y * width + x] : 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      // Outer-border start: foreground with a background pixel to the west.
      if (bin[idx] === 1 && bin[idx - 1] === 0 && !visited[idx]) {
        const contour = mooreTrace(at, visited, width, x, y);
        if (contour.length >= 12) contours.push(contour);
      }
    }
  }
  return contours;
}

function mooreTrace(
  at: (x: number, y: number) => number,
  visited: Uint8Array,
  width: number,
  sx: number,
  sy: number,
): Pt[] {
  const boundary: Pt[] = [[sx, sy]];
  visited[sy * width + sx] = 1;
  let bx = sx;
  let by = sy;
  let cx = sx - 1; // entered from the west
  let cy = sy;
  const maxIter = 4 * (width + width);
  for (let iter = 0; iter < maxIter; iter++) {
    let start = 0;
    for (let k = 0; k < 8; k++) {
      if (bx + NEIGHBOURS[k][0] === cx && by + NEIGHBOURS[k][1] === cy) {
        start = k;
        break;
      }
    }
    let found = false;
    for (let step = 1; step <= 8; step++) {
      const k = (start + step) % 8;
      const nx = bx + NEIGHBOURS[k][0];
      const ny = by + NEIGHBOURS[k][1];
      if (at(nx, ny) === 1) {
        const pk = (start + step - 1) % 8;
        cx = bx + NEIGHBOURS[pk][0];
        cy = by + NEIGHBOURS[pk][1];
        bx = nx;
        by = ny;
        found = true;
        break;
      }
    }
    if (!found) break;
    if (bx === sx && by === sy) break;
    visited[by * width + bx] = 1;
    boundary.push([bx, by]);
  }
  return boundary;
}

function perpDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * (p[0] - a[0]) - dx * (p[1] - a[1])) / len;
}

function dpSegment(points: Pt[], epsilon: number): Pt[] {
  if (points.length < 3) return points;
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDistance(points[i], points[0], points[points.length - 1]);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > epsilon) {
    const left = dpSegment(points.slice(0, idx + 1), epsilon);
    const right = dpSegment(points.slice(idx), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[points.length - 1]];
}

/** Approximate a closed contour to a polygon (Douglas-Peucker). */
function approxPolyDP(contour: Pt[], epsilon: number): Pt[] {
  // Split the closed contour at the point farthest from the first vertex.
  let far = 0;
  let maxD = -1;
  for (let i = 1; i < contour.length; i++) {
    const d = Math.hypot(contour[i][0] - contour[0][0], contour[i][1] - contour[0][1]);
    if (d > maxD) {
      maxD = d;
      far = i;
    }
  }
  const first = dpSegment(contour.slice(0, far + 1), epsilon);
  const second = dpSegment(contour.slice(far).concat([contour[0]]), epsilon);
  return first.slice(0, -1).concat(second.slice(0, -1));
}

function polygonArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
  }
  return Math.abs(a) / 2;
}

function isConvex(poly: Pt[]): boolean {
  let sign = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const c = poly[(i + 2) % n];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cross !== 0) {
      const s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
  }
  return true;
}

/** Order four corners as TL, TR, BR, BL (image space; y grows downward). */
function orderCorners(poly: Pt[]): [Corner, Corner, Corner, Corner] {
  let tl = poly[0];
  let br = poly[0];
  let tr = poly[0];
  let bl = poly[0];
  let minSum = Infinity;
  let maxSum = -Infinity;
  let maxDiff = -Infinity;
  let minDiff = Infinity;
  for (const p of poly) {
    const sum = p[0] + p[1];
    const diff = p[0] - p[1];
    if (sum < minSum) {
      minSum = sum;
      tl = p;
    }
    if (sum > maxSum) {
      maxSum = sum;
      br = p;
    }
    if (diff > maxDiff) {
      maxDiff = diff;
      tr = p;
    }
    if (diff < minDiff) {
      minDiff = diff;
      bl = p;
    }
  }
  return [tl, tr, br, bl];
}

// ---------------------------------------------------------------------------
// Perspective sampling + dictionary match
// ---------------------------------------------------------------------------

function bilinearGray(gray: GrayImage, x: number, y: number): number {
  const { data, width, height } = gray;
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const a = data[y0 * width + x0];
  const b = data[y0 * width + x1];
  const c = data[y1 * width + x0];
  const d = data[y1 * width + x1];
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

/** Number of sub-samples per axis, averaged over each module's central area. */
const SUBSAMPLES = 4;
/** Fraction of a module cell sampled (central portion), avoiding module seams. */
const CELL_SPAN = 0.6;

/**
 * Sample a 6×6 grid of module grays across the quad. Each module is averaged
 * over a `SUBSAMPLES`×`SUBSAMPLES` block covering its central `CELL_SPAN` — far
 * more robust to sensor/render noise than a single point, which is what let a
 * lone noisy pixel flip a border module and fail the border check.
 */
function sampleGridGray(
  gray: GrayImage,
  corners: [Corner, Corner, Corner, Corner],
): number[] {
  const [tl, tr, br, bl] = corners;
  const sample = (u: number, v: number): number => {
    const topX = tl[0] + (tr[0] - tl[0]) * u;
    const topY = tl[1] + (tr[1] - tl[1]) * u;
    const botX = bl[0] + (br[0] - bl[0]) * u;
    const botY = bl[1] + (br[1] - bl[1]) * u;
    const x = topX + (botX - topX) * v;
    const y = topY + (botY - topY) * v;
    return bilinearGray(gray, x, y);
  };

  const samples: number[] = [];
  const step = CELL_SPAN / SUBSAMPLES;
  const start = -CELL_SPAN / 2 + step / 2;
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      let acc = 0;
      let n = 0;
      for (let sy = 0; sy < SUBSAMPLES; sy++) {
        for (let sx = 0; sx < SUBSAMPLES; sx++) {
          const u = (col + 0.5 + start + sx * step) / GRID;
          const v = (row + 0.5 + start + sy * step) / GRID;
          acc += sample(u, v);
          n++;
        }
      }
      samples.push(acc / n);
    }
  }
  return samples;
}

/**
 * Otsu threshold over a small sample set. Returns the centre of the
 * max-between-variance plateau: for a cleanly bimodal marker (only ~0 and ~255
 * present) every split between the two clusters ties, so the argmax alone would
 * sit at the low cluster's edge (0) and mis-classify the black modules. Centring
 * across the plateau puts the threshold safely between black and white.
 */
function otsu(samples: number[]): number {
  const hist = new Array<number>(256).fill(0);
  for (const s of samples) hist[Math.max(0, Math.min(255, Math.round(s)))]++;
  const total = samples.length;
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let firstBest = 128;
  let lastBest = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      firstBest = t;
      lastBest = t;
    } else if (between === maxVar) {
      lastBest = t;
    }
  }
  return Math.floor((firstBest + lastBest) / 2);
}

/** Binarize a 6×6 gray sample set into a bit grid (1 = black module). */
export function grayToBitGrid(samples: number[]): number[][] {
  const threshold = otsu(samples);
  const grid: number[][] = [];
  for (let row = 0; row < GRID; row++) {
    const r: number[] = [];
    for (let col = 0; col < GRID; col++) {
      // Modules at/below the threshold are black (bit 1).
      r.push(samples[row * GRID + col] <= threshold ? 1 : 0);
    }
    grid.push(r);
  }
  return grid;
}

/**
 * Match a 6×6 bit grid to a dictionary marker. Returns `{id, rotation}` for the
 * best match with Hamming distance ≤ 1 over all four rotations, or null. The
 * outer border (all 20 cells) must be black; a border violation rejects.
 */
export function matchMarkerGrid(grid: number[][]): { id: number; rotation: number } | null {
  // Border check: every border module must be black.
  for (let i = 0; i < GRID; i++) {
    if (grid[0][i] !== 1 || grid[GRID - 1][i] !== 1) return null;
    if (grid[i][0] !== 1 || grid[i][GRID - 1] !== 1) return null;
  }
  // Pack the inner 4×4 (rows/cols 1..4) row-major.
  let code = 0;
  for (let row = 1; row < GRID - 1; row++) {
    for (let col = 1; col < GRID - 1; col++) {
      code = (code << 1) | (grid[row][col] & 1);
    }
  }
  let best: { id: number; rotation: number; dist: number } | null = null;
  for (const entry of DICT) {
    for (let r = 0; r < 4; r++) {
      const dist = popcount(code ^ entry.rotations[r]);
      if (dist <= 1 && (best === null || dist < best.dist || (dist === best.dist && entry.id < best.id))) {
        best = { id: entry.id, rotation: r, dist };
      }
    }
  }
  return best ? { id: best.id, rotation: best.rotation } : null;
}

// ---------------------------------------------------------------------------
// Full detection pipeline
// ---------------------------------------------------------------------------

export interface DetectOptions {
  /** Minimum quad area in px² (rejects tiny noise contours). */
  minArea?: number;
  /** Douglas-Peucker epsilon as a fraction of contour perimeter. */
  approxEpsilonFrac?: number;
  thresholdWindow?: number;
  thresholdC?: number;
}

export function detectMarkers(
  image: RgbaImage | GrayImage,
  options: DetectOptions = {},
): DetectedMarker[] {
  const gray: GrayImage = 'data' in image && (image as RgbaImage).data.length ===
    image.width * image.height * 4
    ? toGray(image as RgbaImage)
    : (image as GrayImage);

  const minArea = options.minArea ?? 100;
  const epsFrac = options.approxEpsilonFrac ?? 0.05;
  const bin = adaptiveThreshold(
    gray,
    options.thresholdWindow ?? 21,
    options.thresholdC ?? 7,
  );
  const contours = traceContours(bin, gray.width, gray.height);

  const byId = new Map<number, { marker: DetectedMarker; area: number }>();
  for (const contour of contours) {
    let peri = 0;
    for (let i = 0; i < contour.length; i++) {
      const j = (i + 1) % contour.length;
      peri += Math.hypot(contour[j][0] - contour[i][0], contour[j][1] - contour[i][1]);
    }
    const poly = approxPolyDP(contour, epsFrac * peri);
    if (poly.length !== 4) continue;
    if (!isConvex(poly)) continue;
    const area = polygonArea(poly);
    if (area < minArea) continue;

    const corners = orderCorners(poly);
    const samples = sampleGridGray(gray, corners);
    const grid = grayToBitGrid(samples);
    const match = matchMarkerGrid(grid);
    if (!match) continue;

    const cx = (corners[0][0] + corners[1][0] + corners[2][0] + corners[3][0]) / 4;
    const cy = (corners[0][1] + corners[1][1] + corners[2][1] + corners[3][1]) / 4;
    const marker: DetectedMarker = {
      id: match.id,
      rotation: match.rotation,
      corners,
      center: [cx, cy],
    };
    const prior = byId.get(match.id);
    if (!prior || area > prior.area) byId.set(match.id, { marker, area });
  }

  return [...byId.values()].map((v) => v.marker).sort((a, b) => a.id - b.id);
}
