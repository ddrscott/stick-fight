// Just enough MIME to read a player's email to support (worker/support.ts): the top-level headers as
// they arrived, the plain text of the body (text/plain preferred, else text/html with the tags taken
// out), and how many attachments it carried. Nothing here trusts the message: sizes are capped and a
// part that won't decode is skipped.

export type Mail = {
  headers: [string, string][];   // every top-level header in order, names lower case, folded lines joined
  subject: string;               // RFC 2047 words decoded
  from: { name: string; email: string } | null;   // the From header (what DMARC aligns to)
  messageId: string;             // "<...>" or ""
  references: string;            // In-Reply-To and References, for threading the auto-reply
  text: string;                  // the body as plain text
  attachments: number;
};

const MAX_PARTS = 50, MAX_DEPTH = 5;

/** A byte string: one char per byte, so slicing and searching can't break a multi-byte character. */
const binary = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return s; };
const bytesOf = (s: string) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b; };

function decodeCharset(bytes: Uint8Array, charset: string): string {
  try { return new TextDecoder(charset || "utf-8").decode(bytes); } catch { return new TextDecoder().decode(bytes); }
}
function splitHead(s: string): { head: string; body: string } {
  const m = /\r?\n\r?\n/.exec(s);
  return m ? { head: s.slice(0, m.index), body: s.slice(m.index + m[0].length) } : { head: s, body: "" };
}
export function parseHeaders(head: string): [string, string][] {
  const out: [string, string][] = [];
  for (const line of head.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && out.length) out[out.length - 1][1] += " " + line.trim();
    else { const i = line.indexOf(":"); if (i > 0) out.push([line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim()]); }
  }
  return out;
}
const header = (hs: [string, string][], name: string) => hs.find(([k]) => k === name)?.[1] ?? "";
function param(value: string, name: string): string {
  const m = new RegExp(`(?:^|;)\\s*${name}\\*?=\\s*(?:"([^"]*)"|([^;\\s]*))`, "i").exec(value);
  return m ? (m[1] ?? m[2] ?? "").replace(/^utf-8''/i, "") : "";
}

/** "=?utf-8?B?...?=" and "=?utf-8?Q?...?=" words in a header. */
export function decodeWords(s: string): string {
  return s.replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=(\s+(?==\?))?/gi, (_, cs: string, enc: string, data: string) => {
    try {
      const bytes = enc.toLowerCase() === "b" ? bytesOf(atob(data)) : bytesOf(qp(data.replace(/_/g, " ")));
      return decodeCharset(bytes, cs);
    } catch { return data; }
  });
}
function qp(s: string): string {
  return s.replace(/=\r?\n/g, "").replace(/=([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}
function transfer(body: string, enc: string): Uint8Array {
  enc = enc.toLowerCase();
  if (enc === "base64") { try { return bytesOf(atob(body.replace(/[^A-Za-z0-9+/=]/g, ""))); } catch { return new Uint8Array(); } }
  if (enc === "quoted-printable") return bytesOf(qp(body));
  return bytesOf(body);
}
export function htmlToText(html: string): string {
  return html.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}

type Found = { plain: string[]; html: string[]; attachments: number; parts: number };
function walk(part: string, found: Found, depth: number) {
  if (found.parts++ > MAX_PARTS || depth > MAX_DEPTH) return;
  const { head, body } = splitHead(part);
  const hs = parseHeaders(head);
  const type = header(hs, "content-type") || "text/plain";
  const mime = type.split(";")[0].trim().toLowerCase();
  const disp = header(hs, "content-disposition").toLowerCase();
  if (mime.startsWith("multipart/")) {
    const b = param(type, "boundary");
    if (!b) return;
    const pieces = body.split(new RegExp(`\\r?\\n?--${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?[ \\t]*\\r?\\n?`));
    for (const p of pieces.slice(1)) if (p.trim()) walk(p, found, depth + 1);
    return;
  }
  if (mime === "message/rfc822") { found.attachments++; return; }
  if (disp.startsWith("attachment") || param(disp, "filename") || param(type, "name") || !mime.startsWith("text/")) { found.attachments++; return; }
  const text = decodeCharset(transfer(body, header(hs, "content-transfer-encoding")), param(type, "charset"));
  (mime === "text/html" ? found.html : found.plain).push(text);
}

function address(v: string): { name: string; email: string } | null {
  const s = decodeWords(v);
  const angle = /<([^<>\s]+@[^<>\s]+)>/.exec(s);
  const email = (angle ? angle[1] : (/[^\s<>"]+@[^\s<>"]+/.exec(s) || [""])[0]).trim().toLowerCase();
  if (!email) return null;
  const name = angle ? s.slice(0, angle.index).replace(/["']/g, "").trim() : "";
  return { name, email };
}

export function parseMail(raw: Uint8Array): Mail {
  const s = binary(raw);
  const { head } = splitHead(s);
  const headers = parseHeaders(head);
  const found: Found = { plain: [], html: [], attachments: 0, parts: 0 };
  walk(s, found, 0);
  const text = (found.plain.length ? found.plain.join("\n\n") : htmlToText(found.html.join("\n\n"))).replace(/\r\n/g, "\n").trim();
  const msgId = (/<[^<>\s]+>/.exec(header(headers, "message-id")) || [""])[0];
  const refs = [header(headers, "references"), header(headers, "in-reply-to")].join(" ").match(/<[^<>\s]+>/g) || [];
  return {
    headers, subject: decodeWords(header(headers, "subject")).replace(/[\r\n]+/g, " ").trim(),
    from: address(header(headers, "from")), messageId: msgId, references: [...new Set(refs)].join(" "),
    text, attachments: found.attachments,
  };
}

/** The new part of a reply: everything above "On ... wrote:" or the first quoted (">") block. */
export function stripQuoted(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*>/.test(l)) break;
    if (/^\s*On .{3,200}wrote:\s*$/.test(l) || (/^\s*On .{3,200}$/.test(l) && /wrote:\s*$/.test(lines[i + 1] || ""))) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(l) || /^_{5,}$/.test(l) || /^From: .+/.test(l) && /^(Sent|Date): /.test(lines[i + 1] || "")) break;
    out.push(l);
  }
  return out.join("\n").trim();
}

/** The message with one header put first and, when given, its Subject marked (for the private inbox). */
export function annotate(raw: Uint8Array, add: Record<string, string>, subjectPrefix = ""): Uint8Array {
  const clean = (v: string) => v.replace(/[\r\n]+/g, " ").slice(0, 300);
  let top = "";
  for (const [k, v] of Object.entries(add)) top += `${k}: ${clean(v)}\r\n`;
  let rest = raw;
  if (subjectPrefix) {
    // only inside the header block: find "\nSubject:" before the first blank line
    const s = binary(raw.subarray(0, Math.min(raw.length, 64 * 1024)));
    const end = /\r?\n\r?\n/.exec(s)?.index ?? s.length;
    const m = /(^|\n)subject:[ \t]?/i.exec(s.slice(0, end));
    if (m) {
      const at = m.index + m[0].length;
      const p = bytesOf(clean(subjectPrefix) + " ");   // (an ASCII prefix we write ourselves)
      const out = new Uint8Array(raw.length + p.length);
      out.set(raw.subarray(0, at)); out.set(p, at); out.set(raw.subarray(at), at + p.length);
      rest = out;
    } else top += `Subject: ${clean(subjectPrefix)}\r\n`;
  }
  const head = new TextEncoder().encode(top);
  const out = new Uint8Array(head.length + rest.length);
  out.set(head); out.set(rest, head.length);
  return out;
}
