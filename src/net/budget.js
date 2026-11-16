// The online timeout budget: every clock that decides whether a match rides out a bad network or gives up,
// in one place, so the link (src/net/link.js), the netcode (src/net/rollback.js) and the session
// (src/net/online.js) agree. README, Multiplayer, "Reconnecting" walks through it.
//
// The rule: a cellular dropout, a wifi-to-cellular switch or a screen lock of up to about 20 s is a pause with
// RECONNECTING on the HUD, never a lost match. Only LOST_MS (30 s) with no sign of the other side on any path
// ends it, and both sides run the same clocks, so they give up together (whichever gets there first also says
// {t:'lost'} so the other follows at once).
//
// Recovering (fast; these only decide how soon the link notices and repairs, never when it gives up):
//   RTC_TIMEOUT_MS   5 s    first dial: no DataChannel this long and the room socket carries the packets (relay);
//                           the dial keeps going in the background and the match moves to p2p once it opens
//   REDIAL_TRY_MS    8 s    one redial (a fresh RTCPeerConnection, signaled over the room socket) that hasn't
//                           opened in this long is dropped and the next one starts
//   REDIAL_MAX_GAP_MS 15 s  redials back off 1, 2, 4, 8 s up to this, and keep going while the link is up
//   DISCONNECT_MS    2.5 s  the peer connection reports 'disconnected' this long: redial
//   BEAT_MS          0.5 s  each side sends a 1-byte beat down the DataChannel (old builds ignore it)
//   DC_STALE_MS      1.2 s  nothing on the DataChannel this long: packets also go over the room socket
//   DC_DEAD_MS       4 s    nothing on the DataChannel this long: it's dead, redial
//   PING_MS          4 s    the page pings the room socket ('ping'; the room auto-answers 'pong' without waking)
//   PONG_MS          9 s    nothing heard on the room socket this long: it's dead (half-open), reopen it
//   PROBE_MS         2 s    after a network change (online, a wifi/cellular switch, the page coming back): a ping
//                           that isn't answered this fast means the socket died with the old network
//   CONNECT_TRY_MS   4 s    one try to reopen the room socket that hasn't been welcomed in this long is dropped
//
// Giving up (slow; the same on both sides):
//   LOST_MS          30 s   no packet from the other side for this long ends a match (rollback 'no-packets');
//                           stalled this long with packets arriving ('stalled'); nothing between matches this
//                           long ('silent'); no agreement on a match's final state this long ('end-wait'); the
//                           room socket down this long with the DataChannel silent too ('ws:lost')
// Not network: GRACE_MS (20 s, src/net/online.js), how long the host waits on the pick screen for a rival who
// hasn't picked before starting with the rival's current card.

export const RTC_TIMEOUT_MS = 5000;
export const REDIAL_TRY_MS = 8000;
export const REDIAL_MAX_GAP_MS = 15000;
export const DISCONNECT_MS = 2500;
export const BEAT_MS = 500;
export const DC_STALE_MS = 1200;
export const DC_DEAD_MS = 4000;
export const PING_MS = 4000;
export const PONG_MS = 9000;
export const PROBE_MS = 2000;
export const CONNECT_TRY_MS = 4000;
export const LOST_MS = 30000;
