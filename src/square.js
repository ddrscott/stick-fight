// The square: a phone held upright (README, Controls, "Held upright: the square").
//
// Sideways and on a desktop the stage is the whole 1280x720 frame. Held upright that frame is a quarter of the
// screen, so there the page shows the middle 720x720 of the same frame, as wide as the screen, with the HUD's
// bars, names, timer and move hints in a band of their own above it. Nothing about the render changes: the
// two canvases are still 1280x720 and the sides are only clipped.
//
// src/touch.js owns the layout (it knows the controls' size) and calls setSquare(); src/main.js listens and
// tells the camera its safe width and the HUD where its frame is. This module is only the shared numbers.

/** the frame, and the side of the square cut from its middle, in canvas px */
export const FRAME_W = 1280, FRAME_H = 720, SQUARE = 720;
/**
 * The HUD band in its own units: 390 wide (a common phone), scaled to the screen's width within kMin..kMax.
 * `full` holds the bars, the names and the move hints; `compact` drops the hint line on a short screen.
 */
export const BAND = { w: 390, full: 80, compact: 56, kMin: 0.9, kMax: 1.5 };
/** how small the square may get, as a share of the screen's width, before the band and then the controls give way */
export const SQ_FIRST = 0.75, SQ_FLOOR = FRAME_H / FRAME_W;   // 0.5625: the old 16:9 stage's height, so a fighter is never smaller than it was

/** the layout in use, in CSS px: on (the square is showing), side (the square), band (its height), k (band units to px), compact */
export const square = { on: false, side: 0, band: 0, k: 1, compact: false };
const subs = new Set();
/** @param {Partial<typeof square>} next */
export function setSquare(next) {
  const was = `${square.on}|${square.side}|${square.band}|${square.k}|${square.compact}`;
  Object.assign(square, next);
  if (was !== `${square.on}|${square.side}|${square.band}|${square.k}|${square.compact}`) for (const f of subs) { try { f(square); } catch (e) { /* a listener never breaks the layout */ } }
}
/** @param {(s: typeof square) => void} f */
export function onSquare(f) { subs.add(f); f(square); return () => subs.delete(f); }
