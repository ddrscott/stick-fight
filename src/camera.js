// mirror: the screen shows the world flipped left-right (the online guest's own-side view, or
// ?mirror=1). main.js sets it; the sim never reads it. The HUD maps world x to screen x through it,
// and the arena counter-flips its sign text so the signs still read.
// safeW: the width of the frame's middle that's on screen, in frame px (0: all of it). A phone held upright
// shows only the middle 720 of 1280 (src/square.js), so the framing keeps the fighters inside that.
// padTop: frame px a body keeps from the top (null: under the HUD strip). main.js sets both from the layout.
export const camera = { x: 640, y: 360, zoom: 1, shakeX: 0, shakeY: 0, mirror: false, safeW: 0, /** @type {number | null} */ padTop: null };
