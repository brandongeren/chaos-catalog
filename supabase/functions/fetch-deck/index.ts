// Fetches a public deck page for the app, which can't read these sites from the browser (no CORS). Only fetches
// YGOPRODeck deck pages and Konami's card database deck pages (Neuron share links redirect there), follows redirects
// only to those hosts, and returns at most 2 MB of HTML. Parsing happens in the app (src/games/ygo/decks.ts).
//
// Deploy: Supabase dashboard -> Edge Functions -> Deploy a new function -> name "fetch-deck", paste this file.
// Or with the CLI: supabase functions deploy fetch-deck

const ALLOWED = [
  /^https:\/\/(www\.)?ygoprodeck\.com\/deck\/[\w-]+\/?$/,
  /^https:\/\/neuron\.konami\.net\/link\/[\w-]+$/,
  /^https:\/\/www\.db\.yugioh-card\.com\/yugiohdb\/member_deck\.action\?[\w=&%.-]+$/,
]
const MAX_BYTES = 2_000_000
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST { url }' }, 405)
  let url: string
  try {
    url = String((await req.json()).url ?? '')
  } catch {
    return json({ error: 'POST { url }' }, 400)
  }
  for (let hop = 0; hop < 4; hop++) {
    if (!ALLOWED.some((re) => re.test(url))) return json({ error: 'Only YGOPRODeck and Konami/Neuron deck links are supported' }, 400)
    const res = await fetch(url, {
      redirect: 'manual',
      headers: { 'User-Agent': 'chaos-catalog-deck-import/0.1 (+https://github.com/brandongeren/chaos-catalog)' },
      signal: AbortSignal.timeout(15000),
    })
    const next = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && next) {
      url = new URL(next, url).toString()
      continue
    }
    if (!res.ok) return json({ error: `The deck site answered ${res.status}` }, 502)
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.length > MAX_BYTES) return json({ error: 'That page is too large' }, 502)
    return json({ url, html: new TextDecoder().decode(buf) })
  }
  return json({ error: 'Too many redirects' }, 502)
})
