// mirror: the screen shows the world flipped left-right (the online guest's own-side view, or
// ?mirror=1). main.js sets it; the sim never reads it. The HUD maps world x to screen x through it,
// and the arena counter-flips its sign text so the signs still read.
export const camera = { x: 640, y: 360, zoom: 1, shakeX: 0, shakeY: 0, mirror: false };
