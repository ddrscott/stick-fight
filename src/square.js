// The upright view: a phone held upright (README, Controls, "Held upright: the view").
//
// Sideways and on a desktop the stage is the whole 1280x720 frame. Held upright that frame is a quarter of the
// screen, so there the page shows a crop of the same frame, always as wide as the screen and the frame's full
// height, with the HUD's bars, names, timer and move hints in a band of their own above it. The crop is square
// (the middle 720x720) when the screen has room for it; on a shorter screen the view gets shorter, not narrower,
// so the crop gets wider: 720 x (view width / view height) frame px, up to the whole 1280 (the plain 16:9 frame,
// which is what the old stage showed, so a fighter is never smaller than he was). Nothing about the render
// changes: the two canvases are still 1280x720 and only their sides are clipped.
//
// src/touch.js owns the layout (it knows the controls' size) and calls setSquare(); src/main.js listens and
// tells the camera its safe width and the HUD which part of its frame is on screen. This module is only the
// shared numbers.

/** the frame, and the narrowest crop of it (the square), in canvas px */
export const FRAME_W = 1280, FRAME_H = 720, SQUARE = 720;
/**
 * The HUD band in its own units: 390 wide (a common phone), scaled to the screen's width within kMin..kMax.
 * `full` holds the bars, the names and the move hints; `compact` drops the hint line on a short screen.
 */
export const BAND = { w: 390, full: 80, compact: 56, kMin: 0.9, kMax: 1.5 };
/**
 * How short the view may get, as a share of its width, before something else gives way: down to SQ_FIRST
 * (a 960-wide crop) before the band goes compact, then to SQ_FLOOR (the whole 16:9 frame) before the controls
 * shrink. Under SQ_FLOOR the view narrows instead, which takes a tiny screen.
 */
export const SQ_FIRST = 0.75, SQ_FLOOR = FRAME_H / FRAME_W;   // 0.5625: the old 16:9 stage's height

/** the crop of the frame a view w x h CSS px shows, in frame px: 720 (square) to 1280 (the whole 16:9 frame) */
export const cropOf = (w, h) => Math.max(SQUARE, Math.min(FRAME_W, FRAME_H * w / Math.max(1, h)));

/**
 * The layout in use, in CSS px: on (the upright view is showing), w and h (the view), crop (how much of the
 * frame's width it shows, in frame px), band (its height), k (band units to px), compact.
 */
export const square = { on: false, w: 0, h: 0, crop: SQUARE, band: 0, k: 1, compact: false };
const key = () => `${square.on}|${square.w}|${square.h}|${square.crop}|${square.band}|${square.k}|${square.compact}`;
const subs = new Set();
/** @param {Partial<typeof square>} next */
export function setSquare(next) {
  const was = key();
  Object.assign(square, next);
  if (was !== key()) for (const f of subs) { try { f(square); } catch (e) { /* a listener never breaks the layout */ } }
}
/** @param {(s: typeof square) => void} f */
export function onSquare(f) { subs.add(f); f(square); return () => subs.delete(f); }
