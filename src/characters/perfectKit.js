// The shared opening of every character's perfect round finisher (registry `perfect`, README Perfect rounds):
// the winner stoops over the beaten body, takes it ('grab', where the body leaves the floor for the hand) and
// stands up with it. Each character file follows these with its own windup, the 'release' key (the body leaves
// the hand for the camera) and the pose it holds while the body squeaks down the glass.
import { RIG_KIT } from '../fighter/index.js';

const { K, F, LF, RF, HIP } = RIG_KIT;

// hand: 'lHand' (the lead arm), 'rHand' (the near arm) or 'both'
export function stoop(hand = 'lHand', d = 220) {
  const lead = hand === 'lHand' || hand === 'both', near = hand === 'rHand' || hand === 'both';
  const reach = [6, 0], idleL = [36, 86], idleR = [28, 96];
  return [
    K({ ...F(6, HIP - 16, LF + 12, RF - 2), torso: 46, bend: 8, head: -12, la: lead ? [18, 10] : idleL, ra: near ? [14, 8] : idleR }, d, 'inOut'),
    K({ ...F(9, HIP - 22, LF + 14, RF - 2), torso: 56, bend: 10, head: -16, la: lead ? reach : idleL, ra: near ? [2, -4] : idleR }, 90, 'out', 'grab'),
  ];
}

// stand up with it: a collar held out at the shoulder (one hand or two), or the body carried overhead
export function lift(kind = 'collar', hand = 'lHand', d = 220) {
  if (kind === 'overhead') return K({ ...F(2, HIP, LF + 4, RF), torso: 0, bend: -4, head: -10, la: [172, 180], ra: [166, 176] }, d, 'inOut');
  if (kind === 'chest') return K({ ...F(2, HIP - 3, LF + 4, RF), torso: 4, bend: -2, head: -6, la: [70, 120], ra: [62, 116] }, d, 'inOut');
  const up = [104, 112], idle = hand === 'rHand' ? [40, 110] : [30, 120];
  return K({ ...F(2, HIP - 2, LF + 4, RF), torso: 2, bend: -4, head: -6, la: hand === 'rHand' ? idle : up, ra: hand === 'lHand' ? idle : up }, d, 'inOut');
}
