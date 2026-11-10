// Readable text never glows (README, "The look"). This is the DOM twin of plainText() in
// src/combat/hud.js: the `text-shadow` every stylesheet in the game puts on text that's meant to be
// read. It's a firm dark outline (four hard offsets) with a short dark falloff behind it, so a solid
// color holds its contrast over the busy room. It's dark on purpose: a colored blur here is the glow
// the rule bans. The offsets grow with the window, so the outline keeps its weight on a big screen.
const EDGE = 'max(1px, 0.09vw)', INK = 'rgba(4,1,10,0.95)';
export const PLAIN = `0 ${EDGE} 0 ${INK}, 0 calc(-1 * ${EDGE}) 0 ${INK}, ${EDGE} 0 0 ${INK}, calc(-1 * ${EDGE}) 0 0 ${INK}, 0 0 max(3px, 0.25vw) rgba(4,1,10,0.85)`;
