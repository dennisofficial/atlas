#!/usr/bin/env node
// Prompt-cache probe. No dependencies; runs on Node 18+ or Bun.
//
// Sends the same large prompt N times in a row, changing only a few words at the very end, so the
// entire leading prefix is byte-identical across every request. A prefix cache should miss once and
// then serve the rest. Reads usage.prompt_tokens_details.cached_tokens off each response.
//
//   API_KEY=sk-... node cache-probe-standalone.mjs \
//     --base-url=https://api.inference.net/v1 --model=kimi-k3-fast
//
//   API_KEY=sk-or-... node cache-probe-standalone.mjs \
//     --base-url=https://openrouter.ai/api/v1 --model=moonshotai/kimi-k3 \
//     --extra='{"usage":{"include":true}}'
//
//   # Anthropic-style providers need an explicit breakpoint rather than implicit caching:
//   API_KEY=sk-or-... node cache-probe-standalone.mjs \
//     --base-url=https://openrouter.ai/api/v1 --model=anthropic/claude-sonnet-5 --cache-control
//
// Flags: --rounds (8) --words (130000) --gap (10000 ms) --seed (random) --raw --no-cache-key
//
// Note: prompt_cache_key makes api.inference.net return 400 on its Anthropic-backed models
// (claude-sonnet-4-6 and friends) — pass --no-cache-key for those.

const flag = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit === undefined ? fallback : hit.slice(name.length + 3)
}
const num = (name, fallback) => {
  const parsed = Number(flag(name, String(fallback)))
  return Number.isFinite(parsed) ? parsed : fallback
}
const has = (name) => process.argv.includes(`--${name}`)

const BASE_URL = flag('base-url', 'https://api.inference.net/v1').replace(/\/$/, '')
const MODEL = flag('model', 'kimi-k3-fast')
const ROUNDS = num('rounds', 8)
const WORDS = num('words', 130000)
const GAP_MS = num('gap', 10000)
const SEED = num('seed', Math.floor(Math.random() * 1e9))
const EXTRA = JSON.parse(flag('extra', '{}'))
const API_KEY = process.env.API_KEY

if (!API_KEY) {
  console.error('set API_KEY in the environment')
  process.exit(1)
}

const VOCABULARY = [
  'resolve', 'handler', 'registry', 'threshold', 'adapter', 'boundary', 'transcript', 'directory',
  'annotate', 'sequence', 'fragment', 'assemble', 'credential', 'partition', 'listener', 'checkpoint',
]

// A fresh seed means text nobody has ever sent, so round 1 is a true cold start and no earlier run
// can warm the result.
const buildPrefix = (seed, count) => {
  let state = seed
  const out = []
  for (let i = 0; i < count; i += 1) {
    state = (state * 1664525 + 1013904223) % 4294967296
    const word = VOCABULARY[state % VOCABULARY.length]
    out.push(i % 12 === 11 ? `${word}\n` : word)
  }
  return out.join(' ')
}

const bigBlock = (text) =>
  has('cache-control')
    ? [{ type: 'text', text, cache_control: { type: 'ephemeral' } }]
    : text

const cachedOf = (usage) =>
  usage?.prompt_tokens_details?.cached_tokens ??
  usage?.cache_read_input_tokens ??
  usage?.prompt_cache_hit_tokens ??
  0

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ask = async ({ prefix, cacheKey, round }) => {
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: 'You are a terse assistant. Reply with one word.' },
      { role: 'user', content: bigBlock(prefix) },
      { role: 'assistant', content: 'Understood.' },
      { role: 'user', content: `Round ${round}. Reply with the word PONG.` },
    ],
    max_tokens: 8,
    temperature: 0,
    ...(has('no-cache-key') ? {} : { prompt_cache_key: cacheKey }),
    ...EXTRA,
  }

  const started = Date.now()
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const latency = Date.now() - started

  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`)

  const payload = await res.json()
  if (has('raw')) console.log(`      upstream=${payload.provider ?? 'n/a'} usage=${JSON.stringify(payload.usage)}`)

  const usage = payload.usage ?? {}
  return { prompt: usage.prompt_tokens ?? 0, cached: cachedOf(usage), latency }
}

const main = async () => {
  const prefix = buildPrefix(SEED, WORDS)
  const cacheKey = `cache-probe-${Date.now()}`

  console.log(`\n${BASE_URL} · ${MODEL} · seed ${SEED} · ${ROUNDS} rounds ${GAP_MS}ms apart`)
  if (has('cache-control')) console.log('(explicit cache_control breakpoint on the large block)')

  const rows = []
  for (let round = 1; round <= ROUNDS; round += 1) {
    try {
      const { prompt, cached, latency } = await ask({ prefix, cacheKey, round })
      rows.push({ prompt, cached })
      const pct = prompt === 0 ? 0 : (100 * cached) / prompt
      console.log(
        `  ${String(round).padStart(2)}  prompt ${String(prompt).padStart(7)}` +
        `  cached ${String(cached).padStart(7)}  ${pct.toFixed(1).padStart(5)}%  ${latency}ms`,
      )
    } catch (error) {
      console.log(`  ${String(round).padStart(2)}  failed: ${error.message}`)
    }
    if (round < ROUNDS) await sleep(GAP_MS)
  }

  if (rows.length === 0) return
  const prompt = rows.reduce((s, r) => s + r.prompt, 0)
  const cached = rows.reduce((s, r) => s + r.cached, 0)
  const zeros = rows.filter((r) => r.cached === 0).length
  console.log(`  summary: ${((100 * cached) / prompt).toFixed(1)}% cached, ${zeros} of ${rows.length} returned zero\n`)
}

await main()
