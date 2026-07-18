import { describe, it, expect } from 'vitest';
import { fitBoard, findHomography, boardFrameRotation } from '../src/vision/board';
import { cornerMarkerSquare } from '../src/vision/geometry';
import type { DetectedMarker, Corner } from '../src/vision/detect';

/** A plausible camera homography: board-mm → image-px (perspective + offset). */
const H_TRUE = [3.1, 0.22, 40, 0.15, 2.95, 30, 0.00035, 0.00021, 1];

function project(h: number[], x: number, y: number): [number, number] {
  const u = h[0] * x + h[1] * y + h[2];
  const v = h[3] * x + h[4] * y + h[5];
  const w = h[6] * x + h[7] * y + h[8];
  return [u / w, v / w];
}

function fakeCorner(id: number): DetectedMarker {
  const square = cornerMarkerSquare(id);
  const corners = square.map(([x, y]) => project(H_TRUE, x, y)) as unknown as [
    Corner,
    Corner,
    Corner,
    Corner,
  ];
  const cx = corners.reduce((s, c) => s + c[0], 0) / 4;
  const cy = corners.reduce((s, c) => s + c[1], 0) / 4;
  return { id, rotation: 0, corners, center: [cx, cy] };
}

describe('findHomography (normalized DLT)', () => {
  it('recovers a known homography to sub-pixel accuracy', () => {
    const board: Array<[number, number]> = [
      [0, 0],
      [720, 0],
      [720, 500],
      [0, 500],
      [360, 250],
    ];
    const image = board.map(([x, y]) => project(H_TRUE, x, y)) as Array<[number, number]>;
    // Fit board-mm → image-px and check reprojection.
    const h = findHomography(board, image);
    let maxErr = 0;
    for (let i = 0; i < board.length; i++) {
      const [u, v] = project(h, board[i][0], board[i][1]);
      maxErr = Math.max(maxErr, Math.hypot(u - image[i][0], v - image[i][1]));
    }
    expect(maxErr).toBeLessThan(0.5);
  });
});

describe('fitBoard', () => {
  it('fits all four corners with < 0.5 px reprojection back to the image', () => {
    const markers = [0, 1, 2, 3].map(fakeCorner);
    const board = fitBoard(markers);
    expect(board).not.toBeNull();
    expect(board!.cornerIds).toEqual([0, 1, 2, 3]);
    // reprojection error is in mm; map board→image and compare to the true model.
    let maxPx = 0;
    for (const id of [0, 1, 2, 3]) {
      for (const [x, y] of cornerMarkerSquare(id)) {
        const [ux, uy] = board!.boardToImage([x, y]);
        const [tx, ty] = project(H_TRUE, x, y);
        maxPx = Math.max(maxPx, Math.hypot(ux - tx, uy - ty));
      }
    }
    expect(maxPx).toBeLessThan(0.5);
    expect(board!.reprojectionError).toBeLessThan(0.05);
  });

  it('maps image points to board-mm, inverting the camera model', () => {
    const markers = [0, 1, 2, 3].map(fakeCorner);
    const board = fitBoard(markers)!;
    const [imgX, imgY] = project(H_TRUE, 360, 250); // board centre → image
    const [bx, by] = board.imageToBoard([imgX, imgY]);
    expect(Math.hypot(bx - 360, by - 250)).toBeLessThan(0.5);
  });

  it('still fits from only three corners (≥ 3 required)', () => {
    const markers = [0, 1, 3].map(fakeCorner);
    const board = fitBoard(markers);
    expect(board).not.toBeNull();
    expect(board!.cornerIds).toEqual([0, 1, 3]);
  });

  it('returns null with fewer than three corners', () => {
    const markers = [0, 1].map(fakeCorner);
    expect(fitBoard(markers)).toBeNull();
  });
});

describe('boardFrameRotation', () => {
  // A dial tile at board cell centre (360, 250), 36 mm marker. Its canonical
  // corners in board mm are [TL, TR, BR, BL]; projected through the same camera
  // model they land in image-geometric order, so `corners[rotation]` is the
  // printed top-left. The recovered board-frame rotation must equal the turn —
  // under the perspective in H_TRUE, i.e. via the homography, not the raw image.
  const half = 18;
  const boardSquare: Array<[number, number]> = [
    [360 - half, 250 - half], // TL
    [360 + half, 250 - half], // TR
    [360 + half, 250 + half], // BR
    [360 - half, 250 + half], // BL
  ];

  it('recovers each of the four rotations in the board frame', () => {
    const board = fitBoard([0, 1, 2, 3].map(fakeCorner))!;
    const corners = boardSquare.map(([x, y]) => project(H_TRUE, x, y)) as unknown as [
      Corner,
      Corner,
      Corner,
      Corner,
    ];
    const cx = corners.reduce((s, c) => s + c[0], 0) / 4;
    const cy = corners.reduce((s, c) => s + c[1], 0) / 4;
    for (let r = 0; r < 4; r++) {
      const marker: DetectedMarker = { id: 42, rotation: r, corners, center: [cx, cy] };
      expect(boardFrameRotation(marker, board)).toBe(r);
    }
  });
});
