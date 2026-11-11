// The share image's text layout (worker/og.ts), kept free of WebAssembly so Node can test it
// (scripts/og/check.mjs). resvg draws the text but can't say how wide it came out, so the widths come
// from each face's advances (worker/og-metrics.ts, measured from the same TTFs).
import { ADVANCE } from "./og-metrics.ts";

/** the name stays clear of the fighters on the right of the background */
export const NAME_W = 720;

/** how wide a line comes out in a face, at a size, with letter spacing (px) */
export function textWidth(s: string, face: "bungee" | "teko", size: number, spacing = 0): number {
  let w = 0;
  for (const ch of s) w += (ADVANCE[face][ch] ?? ADVANCE[face]["M"]) * size / 1000 + spacing;
  return w;
}

/** The name in as few lines as it takes (two at most) at the biggest size that fits NAME_W. */
export function fitName(name: string): { size: number; lines: string[] } {
  const words = name.split(" ").filter(Boolean);
  for (let size = 120; size >= 40; size -= 4) {
    const lines: string[] = [];
    for (const w of words) {
      const last = lines.length ? `${lines[lines.length - 1]} ${w}` : w;
      if (lines.length && textWidth(last, "bungee", size) <= NAME_W) lines[lines.length - 1] = last;
      else lines.push(w);
    }
    if (lines.length <= 2 && lines.every((l) => textWidth(l, "bungee", size) <= NAME_W)) return { size, lines };
  }
  // one long word: a single line, as big as fits
  const size = Math.max(24, Math.floor(40 * NAME_W / textWidth(name, "bungee", 40)));
  return { size, lines: [name] };
}
