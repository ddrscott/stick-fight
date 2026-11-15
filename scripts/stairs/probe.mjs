// Probe (WIP for test:stairs:dmg): place P1 and P2 on a flight or the main floor, press P1's buttons, print P2's stair hits.
//   node scripts/stairs/probe.mjs k1 along1 k2 along2 facing1 facing2 'step:keys,...'   (k -1 = main floor; along = px from flight 0's head)
//   e.g. a floor break by throw: -1 500 -1 432 -1 1 '10:lp+lk'   a 1,2,4 on the steps: 0 110 0 190 1 -1 '10:rp,32:lp,50:rk'   V=1 traces P2
import { installDom } from '../netsim/env.mjs';
installDom();
const R='../../src/';
const { createFighter, MOVES, MOVE_DATA } = await import(R+'fighter/index.js');
const { createArena } = await import(R+'arena/index.js');
const { createCombat } = await import(R+'combat/sim.js');
const { EMPTY_INPUT } = await import(R+'combat/input.js');
await import(R+'characters/index.js');
const arena = createArena('building'), sp = arena.spawns;
const fighters = [createFighter({ x: sp[0].x, y: sp[0].y, facing: 1 }), createFighter({ x: sp[1].x, y: sp[1].y, facing: -1 })];
const sim = createCombat({ fighters, arena, input: { snapshot: () => EMPTY_INPUT }, onEvent(e){}, makeRig:null, moves: MOVES, moveData: MOVE_DATA });
sim.resetMatch({ seed: 7, skipIntro: true });
const [k1,a1,k2,a2,f1,f2,seq] = process.argv.slice(2);
const st = sim.stairs[0], X=(al)=>st.head+st.dir*al;
function onFlight(i, k, x, f){ const u=sim.units[i]; u.x=x; u.facing=f; u.rig.x=x; u.rig.facing=f; if(k>=0){u.stair=k;u.y=sim.stairY(k,x);u.floor=0;} else {u.stair=-1;u.floor=0;u.y=sim.floors[0].y;} u.rig.y=u.y; u.rig.update(0); sim.rigUpd(u,0); }
const presses={}; for (const p of seq.split(',')) { const [t, keys] = p.split(':'); presses[t]={}; for (const kk of keys.split('+')) presses[t][kk]=true; }
let t=0;
sim.setController(0,'s',()=>({...EMPTY_INPUT,...(presses[t]||{})}));
sim.setController(1,'none');
for(let i=0;i<60;i++) sim.tick();
onFlight(0, +k1, X(+a1), +f1); onFlight(1, +k2, X(+a2), +f2);
const h0=sim.units[1].health;
for(t=0;t<900;t++){ sim.tick(); const u=sim.units[1]; if(process.env.V && t%3==0 && t>100 && t<330) console.log(t,u.state,u.rag?'rag':'',u.stair,Math.round(u.rig.joints.hip.x),Math.round(u.rig.joints.hip.y),u.stairPaid,Math.round(u.vx),Math.round(u.vy),'gap',Math.round(Math.min(...Object.values(u.rig.joints).map(j=>sim.stairY(0,j.x)-10-j.y)))); }
const sh=sim.log.filter(r=>r.type==='stairHit'||r.type==='floorBreak'||r.type==='floorLand'||r.type==='callout');
console.log('hp',h0,'->',sim.units[1].health,'state',sim.units[1].state, sh.map(r=>r.type==='stairHit'?`${r.step}:${r.y}/${r.dmg}`:r.type==='callout'?r.text:r.type).join(' '));
