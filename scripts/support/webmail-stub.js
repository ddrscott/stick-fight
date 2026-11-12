// A stand-in for the webmail Worker's Inbound entrypoint, for `npm run test:support` only. The real one
// is being built in the webmail project; until it ships, local dev runs this beside stick-fight
// (wrangler dev -c wrangler.jsonc -c scripts/support/webmail-stub.jsonc) so the WEBMAIL binding resolves.
// deliver() hands what it got to the test's mock server and answers like the real one.
import { WorkerEntrypoint } from 'cloudflare:workers';

export class Inbound extends WorkerEntrypoint {
  async deliver(raw, rcpt, from) {
    const res = await fetch(`${this.env.MOCK}/webmail`, { method: 'POST', headers: { 'x-rcpt': rcpt, 'x-from': from }, body: raw });
    return res.ok ? { ok: true, mailbox: 'support' } : { ok: false, error: `mock said ${res.status}` };
  }
}
export default { fetch: () => new Response('webmail stub') };
