// The building stage: Xiao Xiao's office block, drawn as a cross-section, at night.
//
// Three draw layers, each in world space, the caller applies the camera and parallax:
//   drawFar(ctx, cam)          the night outside: sky and tower silhouettes, full frame. Unlit
//                              mid values; the FX far layer lights it with ambient + a little
//                              point light and hazes it. The caller moves it at FAR_PARALLAX.
//   drawBuilding(ctx, pal, cam) the room, unlit mid-value purples with crisp line work. The
//                              openings (the windows, everything beyond the outer wall) are left
//                              transparent so the far layer shows through.
//   drawBuildingForeground()   true silhouettes: the street lamp outside. The caller moves it at
//                              FOREGROUND_PARALLAX.
// drawBuildingEmissive() paints what glows, including the towers' lit windows and signs,
// offset by the far parallax so they stay pinned to their towers.
//
// FX far layer, what this art is pitched for: the compositor's 'night' preset
// (src/fx/index.js preset('night')): ambient ~[0.34, 0.23, 0.52], far haze [0.04, 0.10, 0.28]
// at amount 0.6, far light 0.1. The shader does farLit = mix(far * Lfar, haze, amount), so the
// far layer can only reach luma ~15 (black fill) to ~41 (white fill) after compositing. The
// sky is painted near black (final ~15 to 17, B/R ~5), the far towers near white (final
// ~38, paler, haze-lit, like the sample's distant blocks), the mid band between, the near
// band dark: 15 to 25 levels of contrast between the masses, all bluer than the wall.
//
// Logical space 2560x720: two office floors, each twice the width of the first building, with a
// straight stair at each end. The fight is symmetric about x 1280: walls at 125 and 2435, a
// stairwell 325px in from each wall (a corner to splat in beyond it, like the first building's
// 290px past its stairwell), the spawns either side of the middle. Layers, top to bottom:
//   y    0..50   a strip of the floor above: desk tops and glowing monitors
//   y   50..70   ceiling slab of the main floor
//   y   70..360  the main floor: elevator | corner | stairwell | doors, vending | two windows |
//                copier, doors | stairwell | corner | outer wall | outside
//   y  360..416  the main floor's wet floor plane, seen from just above: from the back wall
//                (y 360, the walkable line) forward to the cut edge. The mirror lives here.
//   y  416..440  the main slab cut through: a concrete section face, its underside the lower
//                floor's ceiling. The stairwells are holes through both, x 450..790 and 1770..2110.
//   y  440..700  the lower floor: a stair under each hole, storage under the flights, and between
//                the two stair feet the lower room: a lit doorway, the TV, a corridor, a door
//   y  700..720  the lower floor's wet floor plane
//
// Everything rests on something or hangs from something: furniture stands on a floor line,
// lamps hang from a ceiling or sit on a wall, each guard rail is fixed to its stairwell's lip and
// the solid floor either side of it, each flight bears on the slab at its head and the lower floor
// at its foot. The only thing in front of the section cut is the street lamp outside, whose pole
// runs down out of frame to the street.

export const W = 2560;
export const H = 720;
export const MID = W / 2;
export const FAR_PARALLAX = 0.35;
export const FOREGROUND_PARALLAX = 1.4;

export const UP_FLOOR_Y = 50;
export const CEIL_Y = 70;
export const FLOOR_Y = 360;
export const FLOOR_SLAB = 80;   // floor line to the lower ceiling: the floor plane, then the slab's section
export const GLOSS_H = 56;      // the wet floor plane in front of the walkable line: the mirror's depth
export const SLAB_CUT = FLOOR_Y + GLOSS_H; // 416: the cut edge, top of the slab's section face (24 thick, like the slab above)
export const LOW_CEIL_Y = FLOOR_Y + FLOOR_SLAB; // 440
export const LOW_FLOOR_Y = 700;
export const LOW_GLOSS_H = 20;

// Elevator core, hard against the left edge, every floor. Indicators sit on the column.
export const ELEVATOR = { x0: 0, x1: 125, seam: 62, doorTops: { main: 100, lower: 476 } };
export const INDICATORS = [
  { label: '4', light: 'elev4', x: 40, y: 14, w: 44, h: 22 },
  { label: '3', light: 'elev3', x: 40, y: 76, w: 44, h: 22 },
  { label: '2', light: 'elev2', x: 40, y: 448, w: 44, h: 22 },
];
export const PARTITION = { x: W - ELEVATOR.x1, w: 24 }; // the building's outer wall, in section: as far from the middle as the elevator
export const WALL_L = ELEVATOR.x1, WALL_R = PARTITION.x;
// beyond the outer wall the main floor is a glass curtain: the city shows only between the
// ceiling slab and the floor slab; above and below is solid building to the frame edge
export const EXTERIOR = { x: PARTITION.x + PARTITION.w, y: CEIL_Y, w: W + 400 - PARTITION.x - PARTITION.w, h: FLOOR_Y - CEIL_Y };

// ---- the stairs ------------------------------------------------------------------------
// One straight flight per side, 17 steps of 25 run by 20 rise (slope 0.8), from the main floor at its
// head down to the lower floor at its foot. Each runs from near its end wall down toward the middle, so
// the lower floor is the pit between the two feet, and walking past a foot is walking up. The walking
// line is the line through the treads' middles: y = 360 + 0.8 * (x - head) * dir, clamped to the floors.
export const STAIR_RUN = 25, STAIR_RISE = 20, STAIR_N = (LOW_FLOOR_Y - FLOOR_Y) / STAIR_RISE;   // 17
export const STAIR_SLOPE = STAIR_RISE / STAIR_RUN;
export const STAIR_RAIL_H = 44;
export const FLIGHTS = [
  { head: 450, dir: 1 },          // left: down to the right
  { head: W - 450, dir: -1 },     // right: down to the left
].map((f, i) => ({ id: i, ...f, foot: f.head + f.dir * (LOW_FLOOR_Y - FLOOR_Y) / STAIR_SLOPE, back0: f.head - f.dir * STAIR_RUN / 2 }));
// the hole each flight comes up through: from its head to where a man on the steps clears the slab
export const STAIRWELLS = FLIGHTS.map((f) => {
  const a = f.head, b = f.head + f.dir * 340;
  const x0 = Math.min(a, b), x1 = Math.max(a, b);
  return { x0, x1, y: FLOOR_Y, rail: { x0, x1, h: 56 }, toFloor: 1, flight: f.id };
});
export const STAIRWELL = STAIRWELLS[0];   // compatibility: the first one

// Main floor (left to right).
export const TUBES = [{ x: 420, halfW: 100 }, { x: 960, halfW: 100 }, { x: W - 960, halfW: 100 }, { x: W - 420, halfW: 100 }];
export const TUBE_NAMES = ['tubeA', 'tubeB', 'tubeC', 'tubeD'];
export const TUBE_H = 9;
export const TUBE_Y = CEIL_Y + 6;
export const DOOR_SETS = [{ x: 806, y: 170, w: 160, h: 190 }, { x: W - 806 - 160, y: 170, w: 160, h: 190 }];
export const DOORS = DOOR_SETS[0];
export const EXITS = DOOR_SETS.map((d, i) => ({ x: d.x + d.w / 2 - 28, y: 132, w: 56, h: 22, light: i ? 'exitB' : 'exit' }));
export const EXIT = EXITS[0];
export const VENDING = { x: 980, y: 218, w: 64, h: 142 };
export const COPIER = { x: W - 980 - 92, y: 274, w: 92, h: 86 };   // across the room from the vending machine
export const CLOCK = { x: 1012, y: 130, r: 18 };
export const NOTICE = { x: W - 1012 - 34 - 20, y: 124, w: 68, h: 50 };   // a pinboard, where the clock is on the other half
// two windows either side of a pillar at the middle
export const WINDOWS = [{ x: MID - 230, y: 100, w: 210, h: 180 }, { x: MID + 20, y: 100, w: 210, h: 180 }];
// the corners beyond the stairwells: a water cooler on the floor by the elevator, a fire hose cabinet on the outer wall's corner
export const COOLER = { x: 268, y: 266, w: 34, h: 94 };
export const HOSE = { x: W - 300 - 46, y: 196, w: 46, h: 70 };
export const WINDOW = WINDOWS[1];
// the second window's top-right pane is smashed: the rain comes in there and sprays the floor under it
export const BROKEN_PANE = { x: WINDOW.x + WINDOW.w / 2, y: WINDOW.y, w: WINDOW.w / 2, h: WINDOW.h / 2 };
export const RAIN_REGION = { x0: BROKEN_PANE.x + 4, x1: BROKEN_PANE.x + BROKEN_PANE.w - 4, y0: BROKEN_PANE.y, y1: BROKEN_PANE.y + BROKEN_PANE.h };

// Upper strip: desks with monitors.
export const DESK_Y = 36;
const DESK_HUES = ['cyan', 'blue', 'amber', 'magenta', 'green', 'blue', 'cyan', 'amber', 'magenta', 'green'];
export const DESKS = DESK_HUES.map((hue, i) => ({ x: 200 + i * 236, hue }));

// Lower floor. Between the stair feet (725..1835) is the room the fight uses; under each flight is
// storage, and beyond each flight's high end the stair shaft with a window to the street.
export const LOW_ROOM = { x0: FLIGHTS[0].foot, x1: FLIGHTS[1].foot };
export const LOWER_WINDOWS = [{ x: 150, y: 462, w: 110, h: 110 }, { x: W - 150 - 110, y: 462, w: 110, h: 110 }];
export const LOWER_WINDOW = LOWER_WINDOWS[0];
export const DOOR_L = { x: 902, y: 560, w: 84, h: 140 };
export const TV = { x: 1018, y: 456, w: 110, h: 62 };
// the far door is small because it is far: it sits at the end of a corridor whose opening is full height
export const FAR_HALL = { x: MID - 47, y: 560, w: 94, h: 140 };
export const FAR_DOOR = { x: MID - 27, y: 612, w: 54, h: 88 };
export const DOOR_R = { x: W - 902 - 80, y: 560, w: 80, h: 140 };
export const TV2 = { x: W - 1018 - 110, y: 456, w: 110, h: 62 };   // a second screen: the status board
// the top 80px of the lower room is all the game camera shows of it at gameplay zoom, so
// the lower floor's strongest reads sit there: pendant lamps, an exit arrow, the TVs, the stair lamps
export const LOW_PENDANTS = [{ x: 1010 }, { x: MID }, { x: W - 1010 }];
export const LOW_PENDANT_Y = LOW_CEIL_Y + 6;
export const LOW_EXIT = { x: MID + 110, y: 450, w: 64, h: 20 };
// mid-value wall sconces on bare wall between the doorways
export const SCONCES = [{ x: 1172 }, { x: W - 1172 }];
export const SCONCE_Y = 520;
// under each flight: a storage door in its stringer wall, and a mop sink / lockers in the shaft beyond
export const STORE_DOORS = FLIGHTS.map((f) => ({ x: f.dir > 0 ? f.head + 175 : f.head - 175 - 56, y: 606, w: 56, h: 94 }));
export const LOCKERS = FLIGHTS.map((f) => ({ x: f.dir > 0 ? 300 : W - 300 - 64, y: 590, w: 64, h: 110 }));

// Plants, in the room, background art (behind the fighters, so they never cover one): a potted
// plant standing on the main floor in the corner by the elevator, and a planter hanging on
// cables from the ceiling in the corner by the outer wall.
export const PLANT = { x: 172, y: FLOOR_Y };
export const HANGER = { x: W - 170, potY: 96, drop: 96 }; // pot hangs from the ceiling (y 70) at 96..110, vines to ~206
export const PLANT_SPARKLE = { x: 154, y: 250 };
export const BRANCH_SPARKLE = { x: W - 182, y: 150 };
// Foreground: the street lamp outside the building, in front of the section cut. Its pole runs
// down past the frame to the street. At parallax 1.4 a foreground point (fx, fy) lands over
// fighter-space (1.4 fx - 0.4 camX, 1.4 fy - 0.4 camY); the camera's x is at most 2530 - 640 / zoom
// (2117 at the closest zoom), so x 2372 lands at 2474 or more, outside the outer wall, never over the
// fight band. The compositor fades it over a fighter anyway (BRIEF #5).
export const POST = { x: 2372, w: 20, y0: 120 };
export const POST_BULB = { x: 2382, y: 112 };

export const HUES = {
  cyan: [0.35, 0.92, 1.0], blue: [0.4, 0.55, 1.0], white: [1.0, 0.95, 0.85], magenta: [1.0, 0.4, 0.85], pink: [0.92, 0.37, 0.65],
  green: [0.45, 1.0, 0.55], orange: [1.0, 0.55, 0.2], amber: [1.0, 0.75, 0.35], red: [1.0, 0.2, 0.15], exit: [0.3, 1.0, 0.5],
  tube: [0.78, 0.9, 1.0],
};
const CSS = {
  cyan: '90,235,255', blue: '100,140,255', white: '255,242,215', magenta: '255,100,220', pink: '228,58,120', green: '115,255,140',
  orange: '255,140,40', amber: '255,190,90', red: '255,50,40', exit: '40,220,100', tube: '236,248,255',
};

// The walkable stairs for the sim (src/combat/sim.js): each flight's head and foot, which way is down,
// its slope, and where its treads start (the first tread's back edge).
function stairDefs() {
  return FLIGHTS.map((f) => ({
    id: f.id, head: f.head, foot: f.foot, dir: f.dir, slope: STAIR_SLOPE, run: STAIR_RUN, rise: STAIR_RISE,
    back0: f.back0, top: FLOOR_Y, bottom: LOW_FLOOR_Y, toFloor: 1, well: f.id,
    // the stair as solid ground for a body on the point simulation: the main floor's end beyond the head,
    // then the line through the treads' nosings down to the floor (src/fighter/index.js f.slopes). A body on
    // steps rests on their front edges; the walking line through the treads' middles is half a rise lower, and
    // a body lying on that sank into the front of every step
    solid: f.dir > 0
      ? [{ x0: WALL_L, x1: f.head + STAIR_RUN / 2, y0: FLOOR_Y, y1: FLOOR_Y }, { x0: f.head + STAIR_RUN / 2, x1: f.foot + STAIR_RUN / 2, y0: FLOOR_Y, y1: LOW_FLOOR_Y }]
      : [{ x0: f.foot - STAIR_RUN / 2, x1: f.head - STAIR_RUN / 2, y0: LOW_FLOOR_Y, y1: FLOOR_Y }, { x0: f.head - STAIR_RUN / 2, x1: WALL_R, y0: FLOOR_Y, y1: FLOOR_Y }],
  }));
}

export const geometry = {
  floors: [
    { x0: WALL_L, x1: WALL_R, y: FLOOR_Y, glossy: true,
      fightBand: { x0: WALL_L + 25, x1: WALL_R - 25 }, walls: { left: WALL_L, right: WALL_R },
      spawns: [{ x: MID - 220, y: FLOOR_Y, facing: 1 }, { x: MID + 220, y: FLOOR_Y, facing: -1 }] },
    // the lower floor is the room between the stair feet; past a foot the ground is the flight going up,
    // so its band runs wall to wall (a body never reaches it: it's on the stairs first)
    { x0: WALL_L, x1: WALL_R, y: LOW_FLOOR_Y, glossy: true, room: { ...LOW_ROOM },
      fightBand: { x0: WALL_L + 25, x1: WALL_R - 25 }, walls: { left: WALL_L, right: WALL_R },
      spawns: [{ x: MID - 220, y: LOW_FLOOR_Y, facing: 1 }, { x: MID + 220, y: LOW_FLOOR_Y, facing: -1 }] },
  ],
  stairs: stairDefs(),
  stairwell: STAIRWELL,
  stairwells: STAIRWELLS,
  treads: stairTreads(),
  stairRail: stairRails(),
  // where horde goons enter, per floor: 'back' doors face the camera, 'left' is the elevator
  doors: [
    [{ x: DOOR_SETS[0].x + DOOR_SETS[0].w / 2, y: FLOOR_Y, side: 'back', kind: 'double' }, { x: DOOR_SETS[1].x + DOOR_SETS[1].w / 2, y: FLOOR_Y, side: 'back', kind: 'double' },
      { x: ELEVATOR.x1 + 15, y: FLOOR_Y, side: 'left', kind: 'elevator' }],
    [{ x: DOOR_L.x + DOOR_L.w / 2, y: LOW_FLOOR_Y, side: 'back', kind: 'doorway' }, { x: FAR_DOOR.x + FAR_DOOR.w / 2, y: LOW_FLOOR_Y, side: 'back', kind: 'far' },
      { x: DOOR_R.x + DOOR_R.w / 2, y: LOW_FLOOR_Y, side: 'back', kind: 'door' }],
  ],
  reflectY: FLOOR_Y,
  // the mirror: the floor plane only (depth GLOSS_H), not over either stairwell's hole, and only
  // between the walls (outside them the band is solid slab)
  gloss: { y: FLOOR_Y, height: GLOSS_H, depth: GLOSS_H, strength: 0.6,
    x0: WALL_L, x1: WALL_R, gaps: STAIRWELLS.map((s) => ({ x0: s.x0, x1: s.x1 })) },
  farParallax: FAR_PARALLAX,
  foregroundParallax: FOREGROUND_PARALLAX,
  // where weather may enter the room: the smashed pane's column, down to the floor
  rainRegion: RAIN_REGION,
  spawns: [
    { x: MID - 220, y: FLOOR_Y, facing: 1 },
    { x: MID + 220, y: FLOOR_Y, facing: -1 },
  ],
  lights: [
    // main floor anchors
    ...TUBES.map((t, i) => ({ name: TUBE_NAMES[i], x: t.x, y: TUBE_Y + 4, radius: i === 0 || i === 3 ? 300 : 240, color: HUES.tube, intensity: 0.6 })),
    ...EXITS.map((e) => ({ name: e.light, x: e.x + e.w / 2, y: e.y + e.h / 2, radius: 160, color: HUES.exit, intensity: 0.65 })),
    // the city's glow coming in each window: on the sill, centered, so the pool reads as spilling
    // out of the opening onto the sill, the wall under it and the floor. Cool and dim, like the
    // towers' lit windows it stands for; a city across the street never outshines the tubes.
    ...WINDOWS.map((w, i) => ({ name: i === 1 ? 'window' : 'window2', x: w.x + w.w / 2, y: w.y + w.h, radius: 220, color: [0.62, 0.7, 1.0], intensity: 0.55 })),
    { name: 'vending', x: VENDING.x + VENDING.w / 2, y: VENDING.y + 60, radius: 120, color: HUES.pink, intensity: 0.9 },
    { name: 'copier', x: COPIER.x + COPIER.w / 2, y: COPIER.y + 14, radius: 110, color: HUES.cyan, intensity: 0.55 },
    { name: 'elev3', x: INDICATORS[1].x + 22, y: INDICATORS[1].y + 11, radius: 150, color: HUES.cyan, intensity: 0.45 },
    // upper strip
    ...DESKS.map((d, i) => ({ name: 'monitor' + i, x: d.x + 20, y: DESK_Y - 14, radius: 160, color: HUES[d.hue], intensity: 0.5 })),
    { name: 'elev4', x: INDICATORS[0].x + 22, y: INDICATORS[0].y + 11, radius: 140, color: HUES.cyan, intensity: 0.4 },
    // lower floor
    { name: 'doorL', x: DOOR_L.x + DOOR_L.w / 2, y: DOOR_L.y + 70, radius: 260, color: HUES.amber, intensity: 0.4 },
    { name: 'tv', x: TV.x + TV.w / 2, y: TV.y + TV.h / 2, radius: 260, color: HUES.blue, intensity: 0.6 },
    { name: 'tv2', x: TV2.x + TV2.w / 2, y: TV2.y + TV2.h / 2, radius: 220, color: HUES.magenta, intensity: 0.45 },
    { name: 'doorR', x: DOOR_R.x + DOOR_R.w / 2, y: DOOR_R.y + 40, radius: 220, color: HUES.green, intensity: 0.4 },
    ...FLIGHTS.map((f, i) => ({ name: 'stairStrip' + i, x: f.head + f.dir * 300, y: 560, radius: 300, color: [0.7, 0.85, 1.0], intensity: 0.5 })),
    ...LOW_PENDANTS.map((p, i) => ({ name: 'lowPendant' + i, x: p.x, y: LOW_PENDANT_Y + 14, radius: 260, color: HUES.amber, intensity: 0.55 })),
    { name: 'lowExit', x: LOW_EXIT.x + LOW_EXIT.w / 2, y: LOW_EXIT.y + LOW_EXIT.h / 2, radius: 220, color: HUES.exit, intensity: 0.5 },
    ...SCONCES.map((c, i) => ({ name: 'sconce' + i, x: c.x, y: SCONCE_Y + 6, radius: 200, color: HUES.amber, intensity: 0.4 })),
    { name: 'elev2', x: INDICATORS[2].x + 22, y: INDICATORS[2].y + 11, radius: 150, color: HUES.cyan, intensity: 0.4 },
    // the street lamp, on the foreground layer
    { name: 'postBulb', x: POST_BULB.x, y: POST_BULB.y, radius: 200, color: HUES.amber, intensity: 0.5 },
    // the fairy light in the corner plant
    { name: 'plantSparkle', x: PLANT_SPARKLE.x, y: PLANT_SPARKLE.y, radius: 110, color: HUES.cyan, intensity: 0.3 },
  ],
};

// Two palettes. 'shaded' is what the game uses: mid-value purples for the compositor,
// nothing that multiplies down to black. 'lineart' is the Xiao Xiao look.
export const PALETTES = {
  shaded: {
    void: '#4a3762',
    wall: '#9a86ad',
    wallUpper: '#4c3f60',
    ceilSlab: '#3a2f4e',
    wallLower: '#6e5a84',
    slab: '#62507c',
    slabGloss: '#7e5ea6',
    slabEdge: '#9d78c4',
    slabCut: '#4e3f68',   // the slab's section face: solid concrete, darker than the wet floor plane
    nosing: '#b9a3dc',    // lit metal edges: the cut edge, the stairwell lip
    elevator: '#e8e6ee',
    elevatorDoor: '#f0eef4',
    elevatorDark: '#c4c2cc',
    indicator: '#3a2c4c',
    recess: '#55436d',
    tread: '#a897c2',
    stringer: '#5e4c78',  // the flight's side wall, under the steps
    door: '#b9adc4',
    doorPanel: '#64567c',
    glass: '#7f7a9c',
    vending: '#4a3a5c',
    vendingFace: '#6d5278',
    exitBox: '#3c5a4a',
    clock: '#d8d0e0',
    desk: '#6f5c86',
    screen: '#5c4f78',
    silhouette: '#2c2244', // dark purple, never black: lands at luma ~28 after the compositor's tint
    line: '#3a2a52',
    lineW: 1.5,
    frameW: 2.5,
    lineSoft: '#4e3d66',
  },
  lineart: {
    void: '#ffffff', wall: '#ffffff', wallUpper: '#ffffff', wallLower: '#ffffff', ceilSlab: '#ffffff', doorPanel: '#ffffff',
    slab: '#ffffff', slabGloss: '#ffffff', slabEdge: '#ffffff', slabCut: '#ffffff', nosing: '#ffffff',
    elevator: '#8f8f8f', elevatorDoor: '#8f8f8f', indicator: '#ffffff',
    recess: '#ffffff', tread: '#ffffff', stringer: '#ffffff', door: '#ffffff', glass: '#ffffff',
    vending: '#ffffff', vendingFace: '#ffffff', exitBox: '#ffffff', clock: '#ffffff',
    desk: '#ffffff', screen: '#ffffff',
    silhouette: null, // outlines only in line art
    line: '#000000', lineW: 1.2, frameW: 2.6, lineSoft: '#555555',
  },
};

// ---------------------------------------------------------------------------
// helpers

function rect(ctx, x, y, w, h, fill, stroke, lw) {
  if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.strokeRect(x, y, w, h); }
}

function line(ctx, x0, y0, x1, y1, stroke, lw) {
  ctx.strokeStyle = stroke; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
}

function rgba(hue, a) { return `rgba(${CSS[hue]},${a})`; }
function clipRect(ctx, r) { ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip(); }
// sign lettering: in a mirrored view (cam.mirror, the online guest) the whole frame is flipped on
// screen, so the letters are flipped back in place around their center and still read
function signText(ctx, cam, text, x, y) {
  if (!(cam && cam.mirror)) { ctx.fillText(text, x, y); return; }
  ctx.save(); ctx.translate(x, y); ctx.scale(-1, 1); ctx.fillText(text, 0, 0); ctx.restore();
}

// The far layer is drawn at the screen's size (VIEW_W x H), so its world coordinates are only meaningful
// for the camera that drew it. These map them with the screen's own width (the game's 1280, not the
// building's).
export const VIEW_W = 1280;
// Where the far layer has been moved to by the caller, relative to the room, for this
// camera: the emissive pass draws the towers' lights at this offset so they stay on the towers.
export function farOffset(cam) {
  const cx = cam && typeof cam.x === 'number' ? cam.x : VIEW_W / 2;
  const cy = cam && typeof cam.y === 'number' ? cam.y : H / 2;
  return { dx: (cx - VIEW_W / 2) * (1 - FAR_PARALLAX), dy: (cy - H / 2) * (1 - FAR_PARALLAX) };
}

// The FX far layer is drawn at identity (never zoomed) and shifted on screen by
// (camera - centre) * FAR_PARALLAX. The emissive layer is drawn through the full camera
// (zoom z about the centre). This maps far-layer world coordinates into emissive-layer
// coordinates so the lit windows land exactly on their towers at any zoom:
//   screen = world - (c - centre) * k      (far layer)
//   screen = centre + (e - c) * z          (emissive layer)
//   e = c + (world - (c - centre) * k - centre) / z
export function farToEmissive(cam) {
  const cx = cam && typeof cam.x === 'number' ? cam.x : VIEW_W / 2;
  const cy = cam && typeof cam.y === 'number' ? cam.y : H / 2;
  const z = cam && cam.zoom > 0 ? cam.zoom : 1;
  return { s: 1 / z, dx: cx - (VIEW_W / 2 + (cx - VIEW_W / 2) * FAR_PARALLAX) / z, dy: cy - (H / 2 + (cy - H / 2) * FAR_PARALLAX) / z };
}

// ---------------------------------------------------------------------------
// the city outside: one skyline in world space, on the far layer. Three luma bands,
// far (hazed) / mid / near, against a sky that darkens toward the top. The fills are
// unlit values: the FX far layer multiplies by ambient + a little point light, so they
// are pitched bright and cool to come out dim and blue (B well above R) after lighting.

export const HORIZON_Y = WINDOW.y + WINDOW.h + 10; // 290; towers run from their tops down past the frame
// Fills are what the far layer holds before the compositor's ambient and haze (see the
// header): far band near white (paler, haze-lit), mid band cool mid, near band dark.
const BANDS = {
  far: { fill: 'rgb(190,205,240)', dark: 'rgb(70,85,125)', win: 2, wh: 2, every: 9, winAlpha: 0.3 },
  mid: { fill: 'rgb(105,150,205)', dark: 'rgb(30,50,85)', win: 3, wh: 2, every: 11, winAlpha: 0.55 },
  near: { fill: 'rgb(14,22,48)', dark: 'rgb(4,7,20)', win: 4, wh: 3, every: 14, winAlpha: 0.65 },
};
// Each tower's window grid: columns fit its width, a margin on each side, the pitch varies a
// little per tower so the city does not read as one dot matrix. Shared by the unlit windows
// on the far layer and the lit ones on the emissive layer, so every dot belongs to a tower.
function towerGrid(ti) {
  const t = TOWERS[ti], B = BANDS[t.band];
  const every = B.every + (ti % 3) - 1;
  const cols = Math.max(1, Math.floor((t.w - 8) / every));
  const x0 = t.x + Math.round((t.w - (cols - 1) * every - B.win) / 2);
  return { t, B, every, cols, x0, y0: t.top + 6 + (ti % 2) * 3 };
}
const LINEART_BANDS = { far: '#bbbbbb', mid: '#888888', near: '#555555' };
// x is far-layer x; top is the tower's top y (negative tops rise above the frame). The far layer moves at
// 0.35 of the camera, so across the wide building it shows far x from about -150 to 1900: the first
// skyline, then a second block of towers further along the street.
const SKYLINE = [
  { band: 'far', x: 120, w: 70, top: 150 }, { band: 'far', x: 860, w: 70, top: 150 }, { band: 'far', x: 975, w: 50, top: 120 },
  { band: 'far', x: 1225, w: 60, top: -60 }, { band: 'far', x: 1335, w: 90, top: 170 },
  { band: 'mid', x: 160, w: 60, top: 200 }, { band: 'mid', x: 915, w: 44, top: 200 }, { band: 'mid', x: 955, w: 34, top: 215 },
  { band: 'mid', x: 1012, w: 26, top: 205 }, { band: 'mid', x: 1035, w: 60, top: 180 },
  { band: 'mid', x: 1170, w: 40, top: -40 }, { band: 'mid', x: 1285, w: 70, top: 20 },
  { band: 'near', x: 90, w: 46, top: 250 }, { band: 'near', x: 985, w: 30, top: 240 }, { band: 'near', x: 1088, w: 24, top: 245 },
  { band: 'near', x: 1105, w: 36, top: 230 }, { band: 'near', x: 1245, w: 50, top: 250 },
];
export const TOWERS = [
  ...SKYLINE,
  // further along: the same kinds of blocks, spaced differently so it doesn't read as a repeat
  { band: 'far', x: -140, w: 80, top: 130 }, { band: 'far', x: 420, w: 60, top: 160 }, { band: 'far', x: 560, w: 90, top: 110 },
  { band: 'far', x: 1480, w: 70, top: 140 }, { band: 'far', x: 1640, w: 56, top: -30 }, { band: 'far', x: 1790, w: 80, top: 160 },
  { band: 'mid', x: -60, w: 50, top: 210 }, { band: 'mid', x: 380, w: 40, top: 190 }, { band: 'mid', x: 640, w: 64, top: 175 },
  { band: 'mid', x: 1430, w: 46, top: 205 }, { band: 'mid', x: 1560, w: 60, top: 60 }, { band: 'mid', x: 1720, w: 38, top: 195 },
  { band: 'near', x: 330, w: 40, top: 245 }, { band: 'near', x: 700, w: 52, top: 235 }, { band: 'near', x: 1400, w: 34, top: 250 },
  { band: 'near', x: 1610, w: 44, top: 240 }, { band: 'near', x: 1850, w: 50, top: 230 },
];
// one hue per tower (warm or cool white for most, an accent on a few), so a tower reads as
// one building with some of its windows on, not confetti
const WIN_HUES = ['white', 'warm', 'white', 'cyan', 'warm', 'white', 'warm', 'white', 'pink', 'white', 'warm', 'cyan', 'white', 'warm', 'white', 'warm', 'white'];
const WIN_CSS = { cyan: '120,225,255', warm: '255,214,160', pink: '255,140,220', white: '225,230,255' };

function hash(a, b, c) { let h = (a * 374761393 + b * 668265263 + c * 2246822519) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return (h ^ (h >>> 16)) >>> 0; }

// The far layer: sky and tower bodies, the whole frame, in world space, no parallax of its own.
// cam.farBase (px): the caller has shifted the far canvas by this much of the parallax already (the
// compositor moves it the rest of the way), so the canvas only has to hold one screen of skyline.
export function drawFar(ctx, pal, cam) {
  const lineart = pal && pal.silhouette === null;
  const bx = cam && cam.farBase ? cam.farBase.x : 0, by = cam && cam.farBase ? cam.farBase.y : 0;
  ctx.save();
  ctx.translate(-bx, -by);
  if (lineart) {
    rect(ctx, -400 + bx, -400 + by, VIEW_W + 800, H + 800, '#ffffff', null);
    for (const t of TOWERS) rect(ctx, t.x, t.top, t.w, H + 400 - t.top, '#ffffff', LINEART_BANDS[t.band], 1);
    ctx.restore();
    return;
  }
  const sky = ctx.createLinearGradient(0, -200, 0, HORIZON_Y);
  sky.addColorStop(0, 'rgb(0,2,10)'); sky.addColorStop(1, 'rgb(14,40,70)');
  ctx.fillStyle = sky; ctx.fillRect(-400 + bx, -400 + by, VIEW_W + 800, H + 800);
  const vx0 = bx - 40, vx1 = bx + VIEW_W + 40;   // only the towers this canvas can show
  for (const band of ['far', 'mid', 'near']) {
    for (let ti = 0; ti < TOWERS.length; ti++) {
      const t = TOWERS[ti];
      if (t.band !== band || t.x > vx1 || t.x + t.w < vx0) continue;
      ctx.fillStyle = BANDS[band].fill;
      ctx.fillRect(t.x, t.top, t.w, H + 400 - t.top);
      // the unlit windows: the grid the lit ones belong to
      const g = towerGrid(ti);
      ctx.fillStyle = g.B.dark;
      const rows = Math.ceil((H + 400 - t.top) / g.every);
      for (let row = 0; row < rows; row++) for (let c = 0; c < g.cols; c++) ctx.fillRect(g.x0 + c * g.every, g.y0 + row * g.every, g.B.win, g.B.wh);
      // a crown line so the top edge reads
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(t.x, t.top, t.w, 1);
    }
    if (band === 'far') {
      // below the horizon the far bases sink into the dark of the street
      const gd = ctx.createLinearGradient(0, HORIZON_Y - 40, 0, HORIZON_Y + 300);
      gd.addColorStop(0, 'rgba(0,2,10,0)'); gd.addColorStop(1, 'rgba(0,2,10,0.7)');
      ctx.fillStyle = gd; ctx.fillRect(-400 + bx, -400 + by, VIEW_W + 800, H + 800);
    }
  }
  ctx.restore();
}

// The towers' lit windows, the signs across the street, a neon edge, a beacon: emissive,
// drawn at the far layer's offset and clipped to the openings.
const BAND_RANK = { far: 0, mid: 1, near: 2 };
function hiddenBehind(ti, x, y) {
  const r = BAND_RANK[TOWERS[ti].band];
  return TOWERS.some((t) => BAND_RANK[t.band] > r && x >= t.x && x < t.x + t.w && y >= t.top);
}
// which far-layer x an opening can show for this camera (with a margin), so the lights of towers out of
// sight aren't drawn
function farSpan(cam, clip) {
  const m = farToEmissive(cam);
  return { x0: (clip.x - m.dx) / m.s - 60, x1: (clip.x + clip.w - m.dx) / m.s + 60 };
}
// The lit windows of every tower drawn once into a bitmap at scale k (device px per far unit), for drawCityLights
let cityBmp = null;
function cityBitmap(k) {
  if (cityBmp && cityBmp.k === k) return cityBmp;
  if (!cityPaths) buildCityPaths();
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity;
  for (const t of TOWERS) { x0 = Math.min(x0, t.x); x1 = Math.max(x1, t.x + t.w); y0 = Math.min(y0, t.top); }
  x0 = Math.floor(x0) - 4; x1 = Math.ceil(x1) + 4; y0 = Math.floor(y0) - 4;
  const y1 = H + 400, canvas = document.createElement('canvas');
  canvas.width = Math.ceil((x1 - x0) * k); canvas.height = Math.ceil((y1 - y0) * k);
  const g = canvas.getContext('2d');
  g.scale(k, k); g.translate(-x0, -y0);
  for (const cp of cityPaths) if (cp.path) { g.fillStyle = cp.fill; g.fill(cp.path); }
  return (cityBmp = { k, canvas, x0, y0 });
}
// Each tower's lit windows as one Path2D per tower (built once): the hash and the occlusion test ran per window
// every frame before; now a frame fills one path per tower that the opening can show.
let cityPaths = null;
function buildCityPaths() {
  cityPaths = TOWERS.map((t, ti) => {
    const g = towerGrid(ti), B = g.B, path = typeof Path2D === 'function' ? new Path2D() : null;
    const rows = Math.ceil((H + 400 - g.t.top) / g.every);
    for (let row = 0; row < rows; row++) {
      for (let c = 0; c < g.cols; c++) {
        if (hash(ti, row, c) % 5 !== 0) continue; // a fifth of the windows are lit
        if (hiddenBehind(ti, g.x0 + c * g.every + 1, g.y0 + row * g.every + 1)) continue;
        if (path) path.rect(g.x0 + c * g.every, g.y0 + row * g.every, B.win, B.wh);
      }
    }
    const hue = WIN_HUES[ti % WIN_HUES.length];
    return { path, x0: t.x, x1: t.x + t.w, fill: `rgba(${WIN_CSS[hue] || WIN_CSS.white},${B.winAlpha})` };
  });
}
function drawCityLights(ctx, cam, clip) {
  const m = farToEmissive(cam), sp = farSpan(cam, clip);
  if (!cityPaths) buildCityPaths();
  ctx.save();
  clipRect(ctx, clip);
  ctx.translate(m.dx, m.dy); ctx.scale(m.s, m.s);
  // At half-size layers (tiers 1 and 0) the lit windows come from one bitmap instead of a few thousand rects a frame:
  // filling those paths was ~30 ms a frame of raster on a software canvas (README, Performance, Chromebooks). The
  // far layer's mapping cancels the zoom, so the city is always drawn at the layer's own scale and one bitmap per
  // scale is exact; it's placed on whole device pixels so the windows stay sharp. Full-size layers draw the paths.
  const t = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
  const k = t ? Math.round(Math.abs(t.a) * 16) / 16 : 1;
  const bm = t && k > 0 && k <= 0.5 && !t.b && !t.c && typeof document !== 'undefined' ? cityBitmap(k) : null;
  if (bm) {
    ctx.setTransform(Math.sign(t.a), 0, 0, Math.sign(t.d) || 1, Math.round(t.e + t.a * bm.x0), Math.round(t.f + t.d * bm.y0));
    ctx.drawImage(bm.canvas, 0, 0);
    ctx.setTransform(t);
  } else for (const cp of cityPaths) {
    if (!cp.path || cp.x0 > sp.x1 || cp.x1 < sp.x0) continue;
    ctx.fillStyle = cp.fill;
    ctx.fill(cp.path);
  }
  for (const n of NEONS) { ctx.fillStyle = n.css; ctx.fillRect(n.x, n.y, n.w, n.h); }
  for (const ti of BEACONS) { const b = TOWERS[ti]; ctx.fillStyle = 'rgba(255,50,40,0.85)'; ctx.fillRect(b.x + b.w / 2 - 2, b.top - 3, 4, 4); }
  ctx.restore();
}
// neon edges on near towers, and the aircraft beacons on the tallest
const NEONS = [{ x: 1262, y: 110, w: 8, h: 170, css: 'rgba(255,100,220,0.5)' }, { x: 1636, y: 120, w: 6, h: 160, css: 'rgba(90,235,255,0.45)' }];
const BEACONS = [3, 21];

// A lit sign as material: colored body, 1px dark outline so the light has an edge,
// a thin hot core line inside, and a colored halo spreading `halo` px past the edge.
// The face is painted at alpha 0.92 whatever the light's intensity (only the halo scales
// with it), so the compositor's emissive gain lands the core at 230 to 245 in hue.
function neonRect(ctx, x, y, w, h, hue, a, halo = 12) {
  if (a <= 0.01) return;
  const g = ctx.createRadialGradient(x + w / 2, y + h / 2, Math.min(w, h) / 2, x + w / 2, y + h / 2, Math.max(w, h) / 2 + halo);
  g.addColorStop(0, rgba(hue, 0.35 * a)); g.addColorStop(1, rgba(hue, 0));
  ctx.fillStyle = g; ctx.fillRect(x - halo, y - halo, w + halo * 2, h + halo * 2);
  ctx.fillStyle = rgba(hue, Math.max(0.92, a)); ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = `rgba(10,5,20,${0.9 * a})`; ctx.lineWidth = 1; ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
  const core = CSS[hue].split(',').map((v) => Math.round(+v * 0.55 + 255 * 0.45)).join(',');
  ctx.strokeStyle = `rgba(${core},${0.8 * a})`; ctx.lineWidth = 1.5; ctx.strokeRect(x + 2.5, y + 2.5, w - 5, h - 5);
}

function drawOpening(ctx, pal, win, frame = true) {
  ctx.clearRect(win.x, win.y, win.w, win.h);
  if (!frame) return;
  line(ctx, win.x + win.w / 2, win.y, win.x + win.w / 2, win.y + win.h, pal.line, pal.lineW);
  line(ctx, win.x, win.y + win.h / 2, win.x + win.w, win.y + win.h / 2, pal.line, pal.lineW);
  rect(ctx, win.x, win.y, win.w, win.h, null, pal.line, pal.frameW);
  rect(ctx, win.x - 8, win.y + win.h, win.w + 16, 7, pal.door, pal.line, pal.lineW);
  if (win === WINDOW) drawBrokenPane(ctx, pal);
}

// The smashed top-right pane: glass left clinging to the frame as jagged triangles, the
// rest open to the night. Shards on the sill below it.
function brokenGlassPath(ctx) {
  const b = BROKEN_PANE;
  ctx.beginPath();
  ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + 26, b.y + 8); ctx.lineTo(b.x + 12, b.y + 40); ctx.lineTo(b.x + 30, b.y + 58); ctx.lineTo(b.x, b.y + 70); ctx.closePath();
  ctx.moveTo(b.x + 40, b.y); ctx.lineTo(b.x + 60, b.y + 18); ctx.lineTo(b.x + 78, b.y + 4); ctx.lineTo(b.x + 96, b.y + 22); ctx.lineTo(b.x + 110, b.y); ctx.closePath();
  ctx.moveTo(b.x + b.w, b.y + 50); ctx.lineTo(b.x + b.w - 30, b.y + 66); ctx.lineTo(b.x + b.w - 12, b.y + b.h); ctx.lineTo(b.x + b.w, b.y + b.h); ctx.closePath();
  ctx.moveTo(b.x + 40, b.y + b.h); ctx.lineTo(b.x + 58, b.y + b.h - 24); ctx.lineTo(b.x + 84, b.y + b.h); ctx.closePath();
}

function drawBrokenPane(ctx, pal) {
  const b = BROKEN_PANE;
  ctx.save();
  // the glass still clinging to the frame: dark, translucent over the night, a thin dark edge
  brokenGlassPath(ctx);
  ctx.fillStyle = pal.silhouette ? 'rgba(8,6,18,0.55)' : '#ffffff'; ctx.fill();
  ctx.strokeStyle = pal.line; ctx.lineWidth = pal.lineW * 0.8; ctx.stroke();
  // a few shards on the sill
  ctx.fillStyle = pal.silhouette ? 'rgba(8,6,18,0.7)' : '#ffffff'; ctx.strokeStyle = pal.line; ctx.lineWidth = pal.lineW * 0.8;
  for (const [sx, sw] of [[b.x + 8, 10], [b.x + 34, 7], [b.x + 62, 12], [b.x + 90, 6]]) {
    ctx.beginPath(); ctx.moveTo(sx, WINDOW.y + WINDOW.h + 1); ctx.lineTo(sx + sw / 2, WINDOW.y + WINDOW.h - 7); ctx.lineTo(sx + sw, WINDOW.y + WINDOW.h + 1); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// stairs: a flight is a stepped profile from its head on the main floor down to its foot on the lower
// floor, run first then rise, each tread STAIR_RUN deep

function flightPoints(f) {
  const pts = [[f.back0, FLOOR_Y]];
  let x = f.back0, y = FLOOR_Y;
  for (let i = 0; i < STAIR_N; i++) { x += f.dir * STAIR_RUN; pts.push([x, y]); y += STAIR_RISE; pts.push([x, y]); }
  return pts;
}

// Every step's top surface for falling-body collision, in world coordinates, exactly the drawn
// stair: the horizontal runs of both flights (the first is level with the main floor).
export function stairTreads() {
  const r = (v) => Math.round(v * 100) / 100;
  const out = [];
  for (const f of FLIGHTS) {
    const pts = flightPoints(f);
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      if (Math.abs(ay - by) < 1e-6 && Math.abs(ax - bx) > 1e-6) out.push({ x0: r(Math.min(ax, bx)), x1: r(Math.max(ax, bx)), y: r(ay), flight: f.id });
    }
  }
  return out;
}

// The handrail along each flight (the line the drawing puts STAIR_RAIL_H above the nosings).
export function stairRails() {
  return FLIGHTS.map((f) => { const pts = flightPoints(f); return { x0: pts[0][0], y0: pts[0][1] - STAIR_RAIL_H, x1: pts[pts.length - 1][0], y1: pts[pts.length - 1][1] - STAIR_RAIL_H }; });
}

function fillProfile(ctx, pts, pal, depth = 24) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i][0], pts[i][1] + depth);
  ctx.closePath();
  ctx.fillStyle = pal.tread; ctx.fill();
  ctx.strokeStyle = pal.line; ctx.lineWidth = pal.lineW; ctx.lineJoin = 'miter'; ctx.stroke();
}

function railing(ctx, pal, pts, every, h) {
  ctx.strokeStyle = pal.lineSoft; ctx.lineWidth = pal.lineW;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += every) { const [x, y] = pts[i]; ctx.moveTo(x, y); ctx.lineTo(x, y - h); }
  ctx.moveTo(pts[0][0], pts[0][1] - h);
  ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1] - h);
  ctx.stroke();
}

// Each flight on the lower floor: beyond its high end the stair shaft (a recess with a window to the
// street, lockers and a mop sink), under it the stringer wall closing off the storage below the steps
// (with its door), then the steps themselves and the handrail. A lamp on a ceiling mount over the
// lower half of each flight.
export const SHAFTS = FLIGHTS.map((f) => (f.dir > 0 ? { x0: WALL_L, x1: f.head + 90 } : { x0: f.head - 90, x1: WALL_R }));
function stairUnderside(f) {
  // the soffit line: from where the flight passes the lower ceiling down to its foot, then along the floor
  const xc = f.head + f.dir * (LOW_CEIL_Y + 24 - FLOOR_Y) / STAIR_SLOPE;
  return [[xc, LOW_CEIL_Y], [f.foot, LOW_FLOOR_Y], [f.dir > 0 ? WALL_L : WALL_R, LOW_FLOOR_Y], [f.dir > 0 ? WALL_L : WALL_R, LOW_CEIL_Y]];
}
function drawFlight(ctx, pal, f, i) {
  const sh = SHAFTS[i];
  // the shaft: recessed, darker
  rect(ctx, sh.x0, LOW_CEIL_Y, sh.x1 - sh.x0, LOW_FLOOR_Y - LOW_CEIL_Y, pal.recess, null);
  line(ctx, f.dir > 0 ? sh.x1 : sh.x0, LOW_CEIL_Y, f.dir > 0 ? sh.x1 : sh.x0, LOW_FLOOR_Y, pal.lineSoft, pal.lineW);
  drawOpening(ctx, pal, LOWER_WINDOWS[i]);
  // lockers in the shaft, standing on the floor
  const L = LOCKERS[i];
  rect(ctx, L.x, L.y, L.w, L.h, pal.doorPanel, pal.line, pal.lineW);
  for (let k = 1; k < 3; k++) line(ctx, L.x + k * L.w / 3, L.y, L.x + k * L.w / 3, L.y + L.h, pal.line, pal.lineW);
  for (let k = 0; k < 3; k++) for (let s = 0; s < 3; s++) line(ctx, L.x + k * L.w / 3 + 5, L.y + 10 + s * 5, L.x + (k + 1) * L.w / 3 - 5, L.y + 10 + s * 5, pal.lineSoft, 1);
  // the stringer wall under the flight, with the storage door in it
  const u = stairUnderside(f);
  ctx.beginPath(); ctx.moveTo(u[0][0], u[0][1]); ctx.lineTo(u[1][0], u[1][1]); ctx.lineTo(u[1][0] - f.dir * 1, LOW_FLOOR_Y);
  ctx.lineTo(f.dir > 0 ? sh.x1 : sh.x0, LOW_FLOOR_Y); ctx.lineTo(f.dir > 0 ? sh.x1 : sh.x0, LOW_CEIL_Y); ctx.closePath();
  ctx.fillStyle = pal.stringer; ctx.fill();
  const d = STORE_DOORS[i];
  rect(ctx, d.x, d.y, d.w, d.h, pal.door, pal.line, pal.lineW);
  rect(ctx, d.x + 8, d.y + 10, d.w - 16, 22, pal.glass, pal.lineSoft, pal.lineW * 0.8);
  line(ctx, f.dir > 0 ? d.x + d.w - 9 : d.x + 9, d.y + 50, f.dir > 0 ? d.x + d.w - 9 : d.x + 9, d.y + 64, pal.line, 3);
  // the steps and the handrail
  const pts = flightPoints(f);
  fillProfile(ctx, pts, pal);
  railing(ctx, pal, pts, 4, STAIR_RAIL_H);
  // the stair lamp's mount, flush on the ceiling over the lower half of the flight
  const lx = f.head + f.dir * 300;
  rect(ctx, lx - 14, LOW_CEIL_Y, 28, 6, pal.slab, pal.line, pal.lineW);
}

// Each opening in the main slab where a flight comes up: a real hole through the floor plane and the
// slab under it, the top of the flight seen through it. Its two ends are the slab cut through (the
// section face stops, capped). The waist-high guard rail (background art, behind the fighters) is fixed
// to the opening's far lip, with its end posts standing on the solid floor either side of the hole.
function drawStairwell(ctx, pal, sw) {
  const r = sw.rail, w = sw.x1 - sw.x0, h = LOW_CEIL_Y - FLOOR_Y, f = FLIGHTS[sw.flight];
  rect(ctx, sw.x0, FLOOR_Y, w, h, pal.recess, null);
  ctx.save();
  ctx.beginPath(); ctx.rect(sw.x0, FLOOR_Y, w, h); ctx.clip();
  const pts = flightPoints(f);
  fillProfile(ctx, pts, pal);
  railing(ctx, pal, pts, 4, STAIR_RAIL_H);
  if (pal.silhouette) {
    // the lip shades the top of the hole a little; the treads below it stay readable
    const sh = ctx.createLinearGradient(0, FLOOR_Y, 0, FLOOR_Y + 30);
    sh.addColorStop(0, 'rgba(10,6,24,0.4)'); sh.addColorStop(1, 'rgba(10,6,24,0)');
    ctx.fillStyle = sh; ctx.fillRect(sw.x0, FLOOR_Y, w, 30);
  }
  ctx.restore();
  // the hole's ends: the floor plane and the slab cut through, a thin capped return each side
  for (const [x, d] of [[sw.x0, -1], [sw.x1, 1]]) {
    rect(ctx, d < 0 ? x - 4 : x, FLOOR_Y, 4, h, pal.slabCut, pal.line, pal.lineW);
  }
  // the far lip: a steel nosing along the opening's back edge, what the rail is fixed to
  rect(ctx, sw.x0 - 4, FLOOR_Y, w + 8, 5, pal.nosing, pal.line, pal.lineW);
  // the rail: posts with base plates, a mid rail, a lit top rail. The end posts stand on solid
  // floor just outside the hole; the ones between are bolted to the lip.
  const top = sw.y - r.h, ex0 = r.x0 - 7, ex1 = r.x1 + 7;
  ctx.fillStyle = pal.silhouette ? '#3a2e52' : '#ffffff'; ctx.strokeStyle = pal.line; ctx.lineWidth = pal.lineW;
  const posts = [ex0, ex1];
  for (let k = 1; k < 4; k++) posts.push(ex0 + (ex1 - ex0) * k / 4);
  for (const x of posts) {
    ctx.fillRect(x - 2, top, 4, r.h + 3); ctx.strokeRect(x - 2, top, 4, r.h + 3);
    rect(ctx, x - 5, sw.y + 1, 10, 3, pal.silhouette ? '#4a3d66' : '#ffffff', pal.line, pal.lineW * 0.8);
  }
  rect(ctx, ex0 - 2, top + r.h * 0.5, ex1 - ex0 + 4, 2, pal.silhouette ? '#4a3d66' : null, pal.lineSoft, pal.lineW * 0.6);
  rect(ctx, ex0 - 4, top - 3, ex1 - ex0 + 8, 5, pal.silhouette ? '#ece4ff' : '#ffffff', pal.line, pal.lineW);
}

// ---------------------------------------------------------------------------
// rooms

function drawElevator(ctx, pal) {
  rect(ctx, ELEVATOR.x0 - 200, -200, ELEVATOR.x1 - ELEVATOR.x0 + 200, H + 400, pal.elevator, null);
  // the grey box: a solid mass, a darker return along its right edge, two doors per floor
  // with a seam, a lintel and a kick plate, nothing on it lit but the indicators
  rect(ctx, ELEVATOR.x1 - 10, -200, 10, H + 400, pal.elevatorDark || pal.elevator, null);
  const doors = [[ELEVATOR.doorTops.main, FLOOR_Y], [ELEVATOR.doorTops.lower, LOW_FLOOR_Y]];
  for (const [top, bottom] of doors) {
    rect(ctx, ELEVATOR.x0 + 6, top, ELEVATOR.x1 - ELEVATOR.x0 - 22, bottom - top, pal.elevatorDoor, pal.line, pal.lineW);
    rect(ctx, ELEVATOR.x0 + 2, top - 8, ELEVATOR.x1 - ELEVATOR.x0 - 14, 8, pal.elevatorDark || pal.elevator, pal.line, pal.lineW);
    line(ctx, ELEVATOR.seam - 3, top, ELEVATOR.seam - 3, bottom, pal.line, pal.lineW);
    rect(ctx, ELEVATOR.x0 + 6, bottom - 14, ELEVATOR.x1 - ELEVATOR.x0 - 22, 14, pal.elevatorDark || pal.elevator, pal.line, pal.lineW * 0.8);
    const eo = top === ELEVATOR.doorTops.main ? doorOpen(0, 2) : 0;
    if (eo > 0) rect(ctx, ELEVATOR.seam - 3 - 40 * eo, top + 2, 80 * eo, bottom - top - 2, pal.silhouette ? '#e6d8b8' : '#ffffff', pal.line, pal.lineW);
    if (pal.silhouette) {
      // lit from above (the indicator and the ceiling), falling into shade toward the floor
      const g = ctx.createLinearGradient(0, top - 8, 0, bottom);
      g.addColorStop(0, 'rgba(12,8,26,0)'); g.addColorStop(0.5, 'rgba(12,8,26,0.08)'); g.addColorStop(1, 'rgba(12,8,26,0.32)');
      ctx.fillStyle = g; ctx.fillRect(ELEVATOR.x0 - 200, top - 8, ELEVATOR.x1 - ELEVATOR.x0 + 200, bottom - top + 8);
    }
  }
  line(ctx, ELEVATOR.x1, -200, ELEVATOR.x1, H + 200, pal.lineSoft, pal.frameW);
  wallFace(ctx, pal, ELEVATOR.x1 - 6, 1);
  for (const ind of INDICATORS) rect(ctx, ind.x, ind.y, ind.w, ind.h, pal.indicator, pal.line, pal.lineW);
}

function drawUpperStrip(ctx, pal) {
  rect(ctx, -200, -200, W + 400, UP_FLOOR_Y + 200, pal.wallUpper, null);
  for (const d of DESKS) {
    rect(ctx, d.x - 30, DESK_Y, 100, 5, pal.desk, pal.line, pal.lineW);
    line(ctx, d.x - 24, DESK_Y + 5, d.x - 24, UP_FLOOR_Y, pal.lineSoft, pal.lineW);
    line(ctx, d.x + 64, DESK_Y + 5, d.x + 64, UP_FLOOR_Y, pal.lineSoft, pal.lineW);
    rect(ctx, d.x - 8, DESK_Y - 38, 56, 36, pal.screen, pal.line, pal.lineW);
    line(ctx, d.x + 20, DESK_Y - 2, d.x + 20, DESK_Y, pal.line, 3);
  }
}

function drawDoors(ctx, pal, d, j) {
  rect(ctx, d.x, d.y, d.w, d.h, pal.doorPanel || pal.door, null);
  const ww = 56, wh = 60, wy = d.y + 18;
  rect(ctx, d.x + 12, wy, ww, wh, pal.glass, pal.line, pal.lineW);
  rect(ctx, d.x + d.w - 12 - ww, wy, ww, wh, pal.glass, pal.line, pal.lineW);
  line(ctx, d.x + d.w / 2, d.y, d.x + d.w / 2, d.y + d.h, pal.line, pal.lineW);
  line(ctx, d.x + d.w / 2 - 8, d.y + 105, d.x + d.w / 2 - 8, d.y + 128, pal.line, 3);
  line(ctx, d.x + d.w / 2 + 8, d.y + 105, d.x + d.w / 2 + 8, d.y + 128, pal.line, 3);
  ctx.strokeStyle = pal.line; ctx.lineWidth = pal.frameW;
  ctx.beginPath(); ctx.moveTo(d.x, d.y + d.h); ctx.lineTo(d.x, d.y); ctx.lineTo(d.x + d.w, d.y); ctx.lineTo(d.x + d.w, d.y + d.h); ctx.stroke();
  const o = doorOpen(0, j);
  if (o > 0) {
    // the leaves swing back: a lit corridor opens in the middle
    const gw = (d.w - 8) * o;
    rect(ctx, d.x + d.w / 2 - gw / 2, d.y + 2, gw, d.h - 2, pal.silhouette ? '#cdbfe8' : '#ffffff', pal.line, pal.lineW);
  }
  const e = EXITS[j];
  rect(ctx, e.x, e.y, e.w, e.h, pal.exitBox, pal.line, pal.lineW); // on the wall over the doors
}

function drawVending(ctx, pal) {
  const v = VENDING;
  rect(ctx, v.x, v.y, v.w, v.h, pal.vending, pal.line, pal.lineW);
  rect(ctx, v.x + 6, v.y + 10, v.w - 12, 84, pal.vendingFace, pal.line, pal.lineW);
  rect(ctx, v.x + 6, v.y + 102, v.w - 12, 10, null, pal.line, pal.lineW);
  rect(ctx, v.x + 10, v.y + 118, v.w - 20, 14, null, pal.line, pal.lineW);
  for (let i = 1; i < 4; i++) line(ctx, v.x + 6, v.y + 10 + i * 21, v.x + v.w - 6, v.y + 10 + i * 21, pal.lineSoft, pal.lineW * 0.8);
}

// The photocopier across the room: a body on the floor, the lid, the paper tray out the side, a
// lit control panel (emissive)
function drawCopier(ctx, pal) {
  const c = COPIER;
  rect(ctx, c.x, c.y + 18, c.w, c.h - 18, pal.vending, pal.line, pal.lineW);
  rect(ctx, c.x - 4, c.y + 8, c.w + 8, 10, pal.door, pal.line, pal.lineW);   // the lid
  rect(ctx, c.x + c.w, c.y + 34, 16, 6, pal.door, pal.line, pal.lineW);      // the output tray
  rect(ctx, c.x + 10, c.y + 26, 34, 12, pal.screen, pal.line, pal.lineW * 0.8);
  for (let k = 0; k < 2; k++) rect(ctx, c.x + 8, c.y + 46 + k * 18, c.w - 16, 12, null, pal.lineSoft, pal.lineW * 0.8);
}

// the water cooler: a bottle on a cabinet, standing on the floor; the fire hose cabinet: a box on the wall
// with a glass door and the reel behind it
function drawCorners(ctx, pal) {
  const c = COOLER;
  rect(ctx, c.x, c.y + 34, c.w, c.h - 34, pal.door, pal.line, pal.lineW);
  rect(ctx, c.x + 4, c.y + 30, c.w - 8, 6, pal.doorPanel, pal.line, pal.lineW * 0.8);
  ctx.fillStyle = pal.glass; ctx.strokeStyle = pal.line; ctx.lineWidth = pal.lineW;
  ctx.beginPath(); ctx.moveTo(c.x + 7, c.y + 30); ctx.lineTo(c.x + 5, c.y + 8); ctx.lineTo(c.x + 12, c.y); ctx.lineTo(c.x + c.w - 12, c.y); ctx.lineTo(c.x + c.w - 5, c.y + 8); ctx.lineTo(c.x + c.w - 7, c.y + 30); ctx.closePath(); ctx.fill(); ctx.stroke();
  rect(ctx, c.x + 10, c.y + 46, 6, 6, pal.screen, pal.line, 1); rect(ctx, c.x + c.w - 16, c.y + 46, 6, 6, pal.screen, pal.line, 1);
  const h = HOSE;
  rect(ctx, h.x, h.y, h.w, h.h, pal.silhouette ? '#7a3a4e' : '#ffffff', pal.line, pal.lineW);
  rect(ctx, h.x + 5, h.y + 5, h.w - 10, h.h - 10, pal.glass, pal.line, pal.lineW * 0.8);
  ctx.strokeStyle = pal.line; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(h.x + h.w / 2, h.y + h.h / 2, 13, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(h.x + h.w / 2, h.y + h.h / 2, 5, 0, Math.PI * 2); ctx.stroke();
}

function drawNotice(ctx, pal) {
  const n = NOTICE;
  rect(ctx, n.x, n.y, n.w, n.h, pal.desk, pal.line, pal.lineW);
  for (const [dx, dy, w, h] of [[6, 6, 18, 14], [28, 8, 16, 20], [48, 5, 14, 12], [10, 26, 22, 16], [40, 30, 20, 14]]) rect(ctx, n.x + dx, n.y + dy, w, h, pal.clock, pal.lineSoft, 1);
}

function drawClock(ctx, pal, cam) {
  // in the guest's mirrored view the canvas is flipped, so draw the hands pre-flipped and the time reads the same
  const sx = cam && cam.mirror ? -1 : 1;
  ctx.fillStyle = pal.clock; ctx.strokeStyle = pal.line; ctx.lineWidth = pal.lineW;
  ctx.beginPath(); ctx.arc(CLOCK.x, CLOCK.y, CLOCK.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(CLOCK.x, CLOCK.y); ctx.lineTo(CLOCK.x, CLOCK.y - CLOCK.r * 0.7);
  ctx.moveTo(CLOCK.x, CLOCK.y); ctx.lineTo(CLOCK.x + sx * CLOCK.r * 0.5, CLOCK.y + CLOCK.r * 0.2);
  ctx.stroke();
}

function drawTubes(ctx, pal) {
  for (const t of TUBES) {
    rect(ctx, t.x - t.halfW - 6, CEIL_Y, (t.halfW + 6) * 2, TUBE_H + 5, pal.slab, pal.line, pal.lineW);
    rect(ctx, t.x - t.halfW, CEIL_Y + 3, t.halfW * 2, TUBE_H, pal.clock, pal.line, pal.lineW * 0.8);
  }
}

function drawMainFloor(ctx, pal, cam) {
  rect(ctx, -200, CEIL_Y, W + 400, FLOOR_Y - CEIL_Y, pal.wall, null);
  line(ctx, WALL_L, FLOOR_Y - 10, WALL_R, FLOOR_Y - 10, pal.lineSoft, pal.lineW); // baseboard
  for (const x of [STAIRWELLS[0].x1 + 6, W - STAIRWELLS[0].x1 - 6]) line(ctx, x, CEIL_Y, x, FLOOR_Y - 10, pal.lineSoft, pal.lineW); // wall seams
  // the pillar between the two windows
  rect(ctx, MID - 20, CEIL_Y, 40, FLOOR_Y - CEIL_Y - 10, pal.wall, pal.lineSoft, pal.lineW);
  if (pal.silhouette) {
    // soffit shadow: the slab overhang throws the top of the wall into shade
    const sh = ctx.createLinearGradient(0, CEIL_Y, 0, CEIL_Y + 34);
    sh.addColorStop(0, 'rgba(10,6,24,0.65)'); sh.addColorStop(1, 'rgba(10,6,24,0)');
    ctx.fillStyle = sh; ctx.fillRect(-200, CEIL_Y, W + 400, 34);
    rect(ctx, -200, CEIL_Y, W + 400, 2, 'rgba(8,4,18,0.8)', null);
  }
  DOOR_SETS.forEach((d, j) => drawDoors(ctx, pal, d, j));
  drawVending(ctx, pal);
  drawCopier(ctx, pal);
  drawClock(ctx, pal, cam);
  drawNotice(ctx, pal);
  drawCorners(ctx, pal);
  for (const w of WINDOWS) drawOpening(ctx, pal, w);
  drawPlants(ctx, pal);
  drawTubes(ctx, pal);
}

function drawLowerFloor(ctx, pal) {
  rect(ctx, -200, LOW_CEIL_Y, W + 400, LOW_FLOOR_Y - LOW_CEIL_Y, pal.wallLower, null);
  if (pal.silhouette) {
    // soffit shadow: the slab above throws the top of the lower room into shade
    const sh = ctx.createLinearGradient(0, LOW_CEIL_Y, 0, LOW_CEIL_Y + 44);
    sh.addColorStop(0, 'rgba(10,6,24,0.6)'); sh.addColorStop(1, 'rgba(10,6,24,0)');
    ctx.fillStyle = sh; ctx.fillRect(-200, LOW_CEIL_Y, W + 400, 44);
  }
  line(ctx, WALL_L, LOW_FLOOR_Y - 10, WALL_R, LOW_FLOOR_Y - 10, pal.lineSoft, pal.lineW);
  // the corridor: a full-height opening, its floor and ceiling lines running back to the small far door
  const fh = FAR_HALL, f = FAR_DOOR;
  rect(ctx, fh.x, fh.y, fh.w, fh.h, pal.wallUpper, null);
  ctx.fillStyle = pal.recess;
  ctx.beginPath(); ctx.moveTo(fh.x, fh.y + fh.h); ctx.lineTo(f.x, f.y + f.h); ctx.lineTo(f.x + f.w, f.y + f.h); ctx.lineTo(fh.x + fh.w, fh.y + fh.h); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = pal.lineSoft; ctx.lineWidth = pal.lineW;
  ctx.beginPath();
  ctx.moveTo(fh.x, fh.y); ctx.lineTo(f.x, f.y); ctx.moveTo(fh.x + fh.w, fh.y); ctx.lineTo(f.x + f.w, f.y);
  ctx.moveTo(fh.x, fh.y + fh.h); ctx.lineTo(f.x, f.y + f.h); ctx.moveTo(fh.x + fh.w, fh.y + fh.h); ctx.lineTo(f.x + f.w, f.y + f.h);
  ctx.stroke();
  ctx.strokeStyle = pal.line; ctx.lineWidth = pal.frameW;
  ctx.beginPath(); ctx.moveTo(fh.x, fh.y + fh.h); ctx.lineTo(fh.x, fh.y); ctx.lineTo(fh.x + fh.w, fh.y); ctx.lineTo(fh.x + fh.w, fh.y + fh.h); ctx.stroke();
  rect(ctx, f.x, f.y, f.w, f.h, pal.recess, null);
  const fo = doorOpen(1, 1);
  if (fo > 0) rect(ctx, f.x + 2, f.y + 2, (f.w - 4) * fo, f.h - 2, pal.silhouette ? '#d8c6a4' : '#ffffff', null);
  rect(ctx, f.x + 10, f.y + 10, f.w - 20, 30, pal.glass, pal.lineSoft, pal.lineW * 0.8);
  ctx.strokeStyle = pal.lineSoft; ctx.lineWidth = pal.lineW;
  ctx.beginPath(); ctx.moveTo(f.x, f.y + f.h); ctx.lineTo(f.x, f.y); ctx.lineTo(f.x + f.w, f.y); ctx.lineTo(f.x + f.w, f.y + f.h); ctx.stroke();
  FLIGHTS.forEach((fl, i) => drawFlight(ctx, pal, fl, i));
  // the lit doorway, its door swung open into the room
  const d = DOOR_L;
  rect(ctx, d.x, d.y, d.w, d.h, pal.recess, null);
  ctx.strokeStyle = pal.line; ctx.lineWidth = pal.frameW;
  ctx.beginPath(); ctx.moveTo(d.x, d.y + d.h); ctx.lineTo(d.x, d.y); ctx.lineTo(d.x + d.w, d.y); ctx.lineTo(d.x + d.w, d.y + d.h); ctx.stroke();
  const dOpen = 0.4 + 0.6 * doorOpen(1, 0);
  ctx.fillStyle = pal.door; ctx.strokeStyle = pal.line; ctx.lineWidth = pal.lineW;
  ctx.beginPath(); ctx.moveTo(d.x + d.w, d.y); ctx.lineTo(d.x + d.w + 34 * dOpen + 8, d.y + 10); ctx.lineTo(d.x + d.w + 34 * dOpen + 8, d.y + d.h + 6); ctx.lineTo(d.x + d.w, d.y + d.h); ctx.closePath();
  ctx.fill(); ctx.stroke();
  for (const t of [TV, TV2]) rect(ctx, t.x, t.y, t.w, t.h, pal.screen, pal.line, pal.frameW);
  // pendant lamps and an exit arrow along the lower ceiling
  for (const p of LOW_PENDANTS) {
    line(ctx, p.x, LOW_CEIL_Y, p.x, LOW_PENDANT_Y + 4, pal.line, pal.lineW);
    ctx.fillStyle = pal.slab; ctx.strokeStyle = pal.line; ctx.lineWidth = pal.lineW;
    ctx.beginPath(); ctx.moveTo(p.x - 8, LOW_PENDANT_Y + 4); ctx.lineTo(p.x + 8, LOW_PENDANT_Y + 4); ctx.lineTo(p.x + 22, LOW_PENDANT_Y + 18); ctx.lineTo(p.x - 22, LOW_PENDANT_Y + 18); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  rect(ctx, LOW_EXIT.x, LOW_EXIT.y, LOW_EXIT.w, LOW_EXIT.h, pal.exitBox, pal.line, pal.lineW);
  for (const c of SCONCES) {
    ctx.fillStyle = pal.slab; ctx.strokeStyle = pal.line; ctx.lineWidth = pal.lineW;
    ctx.beginPath(); ctx.moveTo(c.x - 14, SCONCE_Y + 12); ctx.lineTo(c.x + 14, SCONCE_Y + 12); ctx.lineTo(c.x + 9, SCONCE_Y); ctx.lineTo(c.x - 9, SCONCE_Y); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  line(ctx, LOW_EXIT.x + LOW_EXIT.w / 2, LOW_CEIL_Y, LOW_EXIT.x + LOW_EXIT.w / 2, LOW_EXIT.y, pal.line, pal.lineW);
  const r = DOOR_R;
  rect(ctx, r.x, r.y, r.w, r.h, pal.door, null);
  rect(ctx, r.x + 14, r.y + 14, r.w - 28, 46, pal.glass, pal.line, pal.lineW);
  line(ctx, r.x + r.w - 14, r.y + 80, r.x + r.w - 14, r.y + 100, pal.line, 3);
  ctx.strokeStyle = pal.line; ctx.lineWidth = pal.frameW;
  ctx.beginPath(); ctx.moveTo(r.x, r.y + r.h); ctx.lineTo(r.x, r.y); ctx.lineTo(r.x + r.w, r.y); ctx.lineTo(r.x + r.w, r.y + r.h); ctx.stroke();
  const ro = doorOpen(1, 2);
  if (ro > 0) rect(ctx, r.x + 2, r.y + 2, (r.w - 4) * ro, r.h - 2, pal.silhouette ? '#d8c6a4' : '#ffffff', null);
}

function drawSlabs(ctx, pal) {
  const right = W + 200;
  rect(ctx, -200, UP_FLOOR_Y, right + 200, CEIL_Y - UP_FLOOR_Y, pal.ceilSlab || pal.slab, null);
  line(ctx, -200, UP_FLOOR_Y, right, UP_FLOOR_Y, pal.line, pal.lineW);
  line(ctx, -200, CEIL_Y, right, CEIL_Y, pal.line, pal.lineW);
  // the main floor: the wet floor plane between the walls, then the slab's section face, whose
  // underside is the lower ceiling. Outside the walls the whole band is solid slab.
  rect(ctx, -200, FLOOR_Y, right + 200, FLOOR_SLAB, pal.slabCut || pal.slab, null);
  rect(ctx, WALL_L, FLOOR_Y, WALL_R - WALL_L, GLOSS_H, pal.slabGloss, null);
  rect(ctx, WALL_L, FLOOR_Y, WALL_R - WALL_L, 3, pal.slabEdge, null);
  if (pal.silhouette) {
    // the section face: lit along its top by the room, darker toward the underside
    const g = ctx.createLinearGradient(0, SLAB_CUT, 0, LOW_CEIL_Y);
    g.addColorStop(0, 'rgba(10,6,24,0)'); g.addColorStop(1, 'rgba(10,6,24,0.35)');
    ctx.fillStyle = g; ctx.fillRect(-200, SLAB_CUT, right + 200, LOW_CEIL_Y - SLAB_CUT);
  }
  // the cut edge: a lit nosing where the floor plane meets the section face
  rect(ctx, -200, SLAB_CUT, right + 200, 2, pal.nosing || pal.slabEdge, null);
  line(ctx, -200, SLAB_CUT + 2.5, right, SLAB_CUT + 2.5, pal.line, pal.lineW);
  line(ctx, -200, LOW_CEIL_Y, right, LOW_CEIL_Y, pal.line, pal.frameW);
  line(ctx, -200, FLOOR_Y, right, FLOOR_Y, pal.line, pal.frameW);
  rect(ctx, -200, LOW_FLOOR_Y, right + 200, H + 200 - LOW_FLOOR_Y, pal.slabGloss, null);
  rect(ctx, -200, LOW_FLOOR_Y, right + 200, 3, pal.slabEdge, null);
  line(ctx, -200, LOW_FLOOR_Y, right, LOW_FLOOR_Y, pal.line, pal.frameW);
  for (const sw of STAIRWELLS) drawStairwell(ctx, pal, sw);
}

function drawPartition(ctx, pal) {
  rect(ctx, PARTITION.x, -200, PARTITION.w, H + 400, pal.slab, pal.line, pal.lineW);
  wallFace(ctx, pal, PARTITION.x, -1);
}

// The faces fighters get slammed into (arena.walls): a dark kick panel over the fight band with
// a lit edge on the room side, so a body against the wall reads in silhouette. Background art,
// behind the fighters, so it never covers one (BRIEF #5). dir: +1 lit edge on the right, -1 left.
function wallFace(ctx, pal, x, dir) {
  if (!pal.silhouette) return;
  const top = FLOOR_Y - 220, w = 6;
  rect(ctx, x, top, w, FLOOR_Y - top, 'rgba(20,12,34,0.85)', null);
  const ex = dir > 0 ? x + w - 2 : x;
  const g = ctx.createLinearGradient(0, top, 0, FLOOR_Y);
  g.addColorStop(0, 'rgba(200,185,240,0)'); g.addColorStop(0.25, 'rgba(200,185,240,0.9)'); g.addColorStop(1, 'rgba(200,185,240,0.9)');
  ctx.fillStyle = g; ctx.fillRect(ex, top, 2, FLOOR_Y - top);
}

let doorOpen = (_f, _j) => 0;
export function drawBuilding(ctx, pal, cam, state) {
  doorOpen = state && state.doorOpen ? state.doorOpen : () => 0;
  ctx.save();
  ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
  // the room ends at the outer wall; everything beyond it is the far layer showing through
  ctx.clearRect(-400, -400, W + 800, H + 800);
  rect(ctx, -400, -400, W + 800, H + 800, pal.void, null);
  drawUpperStrip(ctx, pal);
  drawMainFloor(ctx, pal, cam);
  drawLowerFloor(ctx, pal);
  drawSlabs(ctx, pal);
  ctx.clearRect(EXTERIOR.x, EXTERIOR.y, EXTERIOR.w, EXTERIOR.h);
  drawPartition(ctx, pal);
  drawElevator(ctx, pal);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// plants: background art in the room's two corners, each carrying a small glowing thing.
// Outlines only in line art.

// A tall, narrow potted plant standing on the floor at PLANT: pot 40 wide, blades fanning up
// to ~175px above the floor.
function plantPath(ctx) {
  ctx.beginPath();
  const x = PLANT.x, y = PLANT.y;
  ctx.moveTo(x - 20, y); ctx.lineTo(x - 17, y - 40); ctx.lineTo(x + 17, y - 40); ctx.lineTo(x + 20, y); ctx.closePath();
  // lance leaves: [tip dx, tip dy, half-width], each a separate pointed blade from the pot rim
  const leaves = [[-38, -150, 13], [-6, -175, 12], [44, -150, 13], [-44, -92, 11], [72, -96, 11], [22, -128, 10], [-26, -120, 10]];
  for (const [tx, ty, hw] of leaves) {
    const bx = x + tx * 0.08, by = y - 40, ex = x + tx, ey = y + ty;
    const mx = (bx + ex) / 2, my = (by + ey) / 2, len = Math.hypot(ex - bx, ey - by) || 1;
    const nx = -(ey - by) / len * hw, ny = (ex - bx) / len * hw;
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(mx + nx, my + ny, ex, ey);
    ctx.quadraticCurveTo(mx - nx, my - ny, bx, by);
    ctx.closePath();
  }
}

// The hanging planter: a pot on three cables from the ceiling, three vines trailing from it
// with small pointed leaves, leaning back into the room (away from the outer wall).
function hangerPath(ctx) {
  const { x, potY, drop } = HANGER;
  ctx.beginPath();
  ctx.moveTo(x - 13, potY); ctx.lineTo(x + 13, potY); ctx.lineTo(x + 9, potY + 14); ctx.lineTo(x - 9, potY + 14); ctx.closePath();
  const vines = [[-8, -0.5], [0, -0.15], [7, 0.1]];
  const top = potY + 10;
  for (const [dx, lean] of vines) {
    for (let s = 0; s < drop; s += 4) {
      const sx = x + dx + lean * s * 0.6 + Math.sin(s * 0.09) * 4, sy = top + s;
      ctx.rect(sx - 1, sy, 2, 5);
    }
    for (let s = 6; s < drop; s += 14) {
      const sx = x + dx + lean * s * 0.6 + Math.sin(s * 0.09) * 4, sy = top + s;
      const side = (s / 14) % 2 >= 1 ? 1 : -1, len = (side > 0 ? 14 : 22) + (s % 4) * 2;
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(sx + side * len * 0.5, sy - 8, sx + side * len, sy + 5);
      ctx.quadraticCurveTo(sx + side * len * 0.45, sy + 7, sx, sy + 3);
      ctx.closePath();
    }
  }
}

function drawPlants(ctx, pal) {
  const { x, potY } = HANGER;
  ctx.save();
  // the planter's cables, from a hook in the ceiling
  ctx.strokeStyle = pal.line; ctx.lineWidth = 1;
  ctx.beginPath();
  for (const dx of [-12, 0, 12]) { ctx.moveTo(x, CEIL_Y); ctx.lineTo(x + dx, potY); }
  ctx.stroke();
  rect(ctx, x - 4, CEIL_Y, 8, 3, pal.slab, pal.line, pal.lineW);
  if (pal.silhouette) {
    ctx.fillStyle = pal.silhouette;
    plantPath(ctx); ctx.fill();
    hangerPath(ctx); ctx.fill();
  } else {
    ctx.strokeStyle = pal.lineSoft; ctx.lineWidth = pal.lineW;
    plantPath(ctx); ctx.stroke();
    hangerPath(ctx); ctx.stroke();
  }
  ctx.restore();
}

function postPath(ctx) {
  ctx.beginPath();
  ctx.rect(POST.x, POST.y0, POST.w, H + 100 - POST.y0);
  ctx.rect(POST.x - 10, POST.y0 - 8, POST.w + 20, 12);
  ctx.rect(POST.x + 4, POST.y0 - 30, POST.w - 8, 24);
}

function fgLights(ctx, lights, lineart) {
  const by = {};
  for (const l of lights || geometry.lights) by[l.name] = l.intensity;
  const k = (n) => (typeof by[n] === 'number' ? by[n] : 1);
  if (lineart) {
    ctx.strokeStyle = '#555'; ctx.lineWidth = 1.2;
    ctx.strokeRect(POST_BULB.x - 6, POST_BULB.y - 4, 12, 8);
    return;
  }
  const a = Math.min(1, k('postBulb') * 2);
  ctx.fillStyle = rgba('amber', 0.35 * a);
  ctx.fillRect(POST_BULB.x - 12, POST_BULB.y - 8, 24, 16);
  ctx.fillStyle = `rgba(255,236,190,${a})`;
  ctx.fillRect(POST_BULB.x - 8, POST_BULB.y - 4, 16, 8);
}

// The foreground is only the street lamp outside: everything in the room is background art.
export function drawBuildingForeground(ctx, pal, lights) {
  ctx.save();
  if (pal.silhouette) {
    ctx.fillStyle = pal.silhouette;
    postPath(ctx); ctx.fill();
    fgLights(ctx, lights, false);
  } else {
    ctx.strokeStyle = pal.lineSoft; ctx.lineWidth = pal.lineW;
    postPath(ctx); ctx.stroke();
    fgLights(ctx, lights, true);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// emissive: everything that glows, full color on a transparent layer, plus the
// city's lights through the openings. `lights` is the live list (intensities flicker).

// part: 'all' (the default), 'static' (everything that doesn't move or flicker: what src/arena/cache.js
// keeps in a bitmap) or 'live' (the city's lights, which follow the far layer's parallax, and the lights
// that flicker: the tubes, the vending machine, the fairy lights). 'static' + 'live' paint what 'all' does.
export function drawBuildingEmissive(ctx, cam, lights, part = 'all') {
  const live = part !== 'static', still = part !== 'live';
  const by = {};
  for (const l of lights || geometry.lights) by[l.name] = l.intensity;
  const k = (n, d = 1) => (typeof by[n] === 'number' ? by[n] : d);
  ctx.save();
  // keep every glow out of the floor bands where fighters lie and bodies pile (BRIEF #5):
  // the bottom 40px above each floor line, across the floor's width, and the stairwells' holes
  ctx.beginPath();
  ctx.rect(-400, -400, W + 800, H + 800);
  for (const fy of [FLOOR_Y, LOW_FLOOR_Y]) ctx.rect(WALL_L, fy - 40, WALL_R - WALL_L, 40);
  for (const sw of STAIRWELLS) ctx.rect(sw.x0, FLOOR_Y, sw.x1 - sw.x0, LOW_CEIL_Y - FLOOR_Y);
  ctx.clip('evenodd');
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  // the city's lights through every opening, pinned to the far layer
  if (live) {
    for (const w of WINDOWS) drawCityLights(ctx, cam, w);
    for (const w of LOWER_WINDOWS) drawCityLights(ctx, cam, w);
    drawCityLights(ctx, cam, EXTERIOR);
  }

  // fluorescent tubes
  if (live) TUBES.forEach((t, i) => {
    const a = k(TUBE_NAMES[i]);
    if (a <= 0.01) return;
    ctx.fillStyle = `rgba(200,230,255,${0.35 * a})`;
    ctx.fillRect(t.x - t.halfW - 8, CEIL_Y + 1, (t.halfW + 8) * 2, TUBE_H + 6);
    ctx.fillStyle = `rgba(236,248,255,${a})`;
    ctx.fillRect(t.x - t.halfW, CEIL_Y + 3, t.halfW * 2, TUBE_H);
  });

  if (still) drawStillEmissive(ctx, cam, k);
  if (live) {
    // vending machine: magenta glass as material, with product rows and a brand strip
    const v = VENDING, a = k('vending');
    neonRect(ctx, v.x + 7, v.y + 11, v.w - 14, 82, 'pink', a, 16);
    ctx.fillStyle = `rgba(255,190,215,${0.85 * a})`;
    ctx.fillRect(v.x + 9, v.y + 13, v.w - 18, 6);
    ctx.fillStyle = `rgba(110,10,50,${0.8 * a})`;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) ctx.fillRect(v.x + 11 + c * 12, v.y + 26 + r * 21, 8, 12);
  }
  if (live) {
    // fairy lights strung in the corner plant and the hanging planter
    const s = Math.min(1, k('plantSparkle') * 2.5);
    ctx.fillStyle = rgba('cyan', s);
    ctx.fillRect(PLANT_SPARKLE.x - 3, PLANT_SPARKLE.y - 3, 6, 6);
    ctx.fillRect(PLANT_SPARKLE.x + 34, PLANT_SPARKLE.y + 30, 4, 4);
    ctx.fillRect(PLANT_SPARKLE.x + 52, PLANT_SPARKLE.y - 34, 3, 3);
    ctx.fillStyle = rgba('white', 0.9);
    ctx.fillRect(BRANCH_SPARKLE.x - 3, BRANCH_SPARKLE.y - 3, 6, 6);
    ctx.fillRect(BRANCH_SPARKLE.x + 8, BRANCH_SPARKLE.y + 30, 3, 3);
  }

  // (the compositor mirrors everything above each floor line into its glossy band)

  ctx.restore();
}

// Everything on the emissive layer that holds still: signs, screens, LED runs, doors, lamps. k(name) is a light's intensity.
function drawStillEmissive(ctx, cam, k) {
  // the double doors: the corridor beyond is lit, so the door windows glow and the frame catches it
  for (const d of DOOR_SETS) {
    const ww = 56, wh = 60, wy = d.y + 18;
    ctx.fillStyle = 'rgba(190,205,255,0.32)';
    ctx.fillRect(d.x + 13, wy + 1, ww - 2, wh - 2); ctx.fillRect(d.x + d.w - 11 - ww, wy + 1, ww - 2, wh - 2);
    ctx.strokeStyle = 'rgba(190,205,255,0.4)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(d.x + 1.5, d.y + d.h); ctx.lineTo(d.x + 1.5, d.y + 1.5); ctx.lineTo(d.x + d.w - 1.5, d.y + 1.5); ctx.lineTo(d.x + d.w - 1.5, d.y + d.h); ctx.stroke();
  }

  // exit signs, green, as material
  for (const e of EXITS) {
    const a = k(e.light);
    neonRect(ctx, e.x + 1, e.y + 1, e.w - 2, e.h - 2, 'exit', a, 10);
    ctx.fillStyle = `rgba(225,255,235,${a})`;
    ctx.font = 'bold 13px Helvetica, Arial, sans-serif';
    signText(ctx, cam, 'EXIT', e.x + e.w / 2, e.y + e.h / 2 + 1);
  }

  // elevator: only the floor indicators glow; the cab is a grey mass
  for (const ind of INDICATORS) {
    const a = k(ind.light);
    ctx.fillStyle = rgba('cyan', a * 0.3);
    ctx.fillRect(ind.x + 1, ind.y + 1, ind.w - 2, ind.h - 2);
    ctx.fillStyle = `rgba(170,250,255,${Math.min(1, a * 2.2)})`;
    ctx.font = 'bold 15px Helvetica, Arial, sans-serif';
    signText(ctx, cam, ind.label, ind.x + 18, ind.y + ind.h / 2 + 1);
    ctx.beginPath();
    ctx.moveTo(ind.x + 30, ind.y + 7); ctx.lineTo(ind.x + 38, ind.y + 7); ctx.lineTo(ind.x + 34, ind.y + 15); ctx.closePath();
    ctx.fill();
  }
  // LED runs: cyan along the main ceiling slab, amber aisle dots along the lower floor's edge
  ctx.fillStyle = rgba('cyan', 0.85);
  for (let x = WALL_L + 24; x < WALL_R; x += 48) ctx.fillRect(x, CEIL_Y - 7, 5, 3);
  ctx.fillStyle = rgba('amber', 0.9);
  for (let x = WALL_L + 40; x < WALL_R - 40; x += 80) ctx.fillRect(x + 40, LOW_FLOOR_Y + 5, 6, 3); // lower floor only: the main band is the mirror's

  // the copier's control panel and its scan bar
  {
    const c = COPIER, a = k('copier');
    neonRect(ctx, c.x + 11, c.y + 27, 32, 10, 'cyan', a, 8);
    ctx.fillStyle = rgba('green', 0.8 * a); ctx.fillRect(c.x + c.w - 22, c.y + 29, 5, 5);
  }

  // upper strip: monitors
  DESKS.forEach((d, i) => {
    const a = k('monitor' + i);
    ctx.fillStyle = rgba(d.hue, 0.6 * a);
    ctx.fillRect(d.x - 6, DESK_Y - 36, 52, 32);
    ctx.fillStyle = `rgba(255,255,255,${0.14 * a})`;
    for (let r = 0; r < 4; r++) ctx.fillRect(d.x - 1, DESK_Y - 31 + r * 7, 18 + r * 7, 2);
  });

  // lower floor: the open doorway (the yellow cabinet of light) as material, the TVs, the right door's window
  {
    // the open doorway: light from a lamp inside, brightest at the top of the opening,
    // falling off down the doorway; hued, never a flat white box
    const d = DOOR_L, a = k('doorL');
    const g = ctx.createRadialGradient(d.x + d.w / 2, d.y + 12, 6, d.x + d.w / 2, d.y + 12, d.h * 1.05);
    g.addColorStop(0, rgba('amber', 0.18 * a)); g.addColorStop(0.35, rgba('amber', 0.11 * a)); g.addColorStop(1, rgba('orange', 0.03 * a));
    ctx.fillStyle = g; ctx.fillRect(d.x + 2, d.y + 2, d.w - 4, d.h - 2);
    ctx.strokeStyle = `rgba(255,220,170,${0.3 * a})`; ctx.lineWidth = 1; ctx.strokeRect(d.x + 2.5, d.y + 2.5, d.w - 5, d.h - 3);
  }
  {
    const a = k('tv');
    ctx.fillStyle = rgba('blue', 0.85 * a);
    ctx.fillRect(TV.x + 3, TV.y + 3, TV.w - 6, TV.h - 6);
    ctx.fillStyle = `rgba(220,235,255,${0.5 * a})`;
    ctx.fillRect(TV.x + 12, TV.y + 14, 46, 18);
    ctx.fillRect(TV.x + 64, TV.y + 38, 32, 8);
  }
  {
    // the status board: rows of bars
    const a = k('tv2'), t = TV2;
    ctx.fillStyle = rgba('magenta', 0.7 * a);
    ctx.fillRect(t.x + 3, t.y + 3, t.w - 6, t.h - 6);
    ctx.fillStyle = `rgba(255,225,245,${0.55 * a})`;
    for (let r = 0; r < 4; r++) ctx.fillRect(t.x + 10, t.y + 10 + r * 12, 30 + ((r * 37) % 50), 5);
  }
  // the lower ceiling's reads: pendants, the exit arrow
  for (let i = 0; i < LOW_PENDANTS.length; i++) {
    const p = LOW_PENDANTS[i], a = k('lowPendant' + i);
    ctx.fillStyle = rgba('amber', 0.35 * a);
    ctx.fillRect(p.x - 24, LOW_PENDANT_Y + 14, 48, 10);
    ctx.fillStyle = `rgba(255,236,190,${a})`;
    ctx.fillRect(p.x - 12, LOW_PENDANT_Y + 15, 24, 4);
  }
  {
    const a = k('lowExit');
    neonRect(ctx, LOW_EXIT.x + 1, LOW_EXIT.y + 1, LOW_EXIT.w - 2, LOW_EXIT.h - 2, 'exit', a, 10);
    ctx.fillStyle = `rgba(225,255,235,${a})`;
    ctx.font = 'bold 12px Helvetica, Arial, sans-serif';
    // the arrow points at the door, which a mirrored view puts on the other side
    signText(ctx, cam, cam && cam.mirror ? '← EXIT' : 'EXIT →', LOW_EXIT.x + LOW_EXIT.w / 2, LOW_EXIT.y + LOW_EXIT.h / 2 + 1);
  }
  {
    const r = DOOR_R, a = k('doorR');
    ctx.fillStyle = rgba('green', 0.7 * a);
    ctx.fillRect(r.x + 15, r.y + 15, r.w - 30, 44);
  }
  ctx.fillStyle = rgba('amber', 0.3);
  ctx.fillRect(FAR_DOOR.x + 11, FAR_DOOR.y + 11, FAR_DOOR.w - 22, 28); // the far door's window, down the corridor
  for (let i = 0; i < SCONCES.length; i++) {
    const c = SCONCES[i], a = k('sconce' + i);
    const g = ctx.createLinearGradient(0, SCONCE_Y - 30, 0, SCONCE_Y);
    g.addColorStop(0, rgba('amber', 0)); g.addColorStop(1, rgba('amber', 0.45 * a));
    ctx.fillStyle = g; ctx.fillRect(c.x - 12, SCONCE_Y - 30, 24, 30);
    ctx.fillStyle = rgba('amber', 0.55 * a); ctx.fillRect(c.x - 8, SCONCE_Y + 1, 16, 3);
  }

  // stairs: an LED strip along every tread nosing, and a lamp over each flight
  FLIGHTS.forEach((f, i) => {
    const a = k('stairStrip' + i), pts = flightPoints(f);
    ctx.fillStyle = `rgba(190,220,255,${0.85 * a})`;
    for (let n = 1; n < pts.length; n += 2) {
      const [x0, y] = pts[n - 1], [x1] = pts[n];
      if (y >= LOW_FLOOR_Y - 1) continue;
      ctx.fillRect(Math.min(x0, x1), y - 1, Math.abs(x1 - x0), 2);
    }
    ctx.fillStyle = `rgba(235,242,255,${a})`;
    ctx.fillRect(f.head + f.dir * 300 - 10, LOW_CEIL_Y + 6, 20, 4); // the lamp under its ceiling mount
  });

  // the smashed pane: short dim glints along the broken edges, and the rain's spray on the floor under it
  {
    ctx.save();
    brokenGlassPath(ctx);
    ctx.setLineDash([6, 14]); ctx.lineDashOffset = 3;
    ctx.strokeStyle = 'rgba(200,220,255,0.22)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
    // where the rain lands: droplets along the crossbar under the hole
    const r = RAIN_REGION;
    ctx.fillStyle = 'rgba(210,230,255,0.55)';
    for (let i = 0; i < 12; i++) ctx.fillRect(r.x0 + ((i * 29) % (r.x1 - r.x0 - 2)), r.y1 - 2 - (i % 3), 2, 2);
  }

}
