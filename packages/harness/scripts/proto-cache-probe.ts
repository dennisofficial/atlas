import { EAuthProvider, secretOf } from '@dltech/atlas-core'

import { AccountStoreProxy } from '../src/cloud/account-store-proxy'
import { CloudSessionStore } from '../src/cloud/cloud-session'
import {
  atlasCloudFile,
  atlasVaultFile,
  atlasVaultKeyFile,
  fileAccountStore,
} from '../src/credentials'
import { BrokeredCredentialPort } from '../src/credentials/brokered-credential-port'
import { SystemClock } from '../src/store'

enum ERoute {
  Inference = 'inference',
  InferenceBase = 'inference-base',
  OpenRouter = 'openrouter',
}

enum ERegime {
  Full = 'full',
  Block = 'block',
  Zero = 'zero',
}

type RouteSpec = {
  route: ERoute
  provider: EAuthProvider
  label: string
  url: string
  modelId: string
  inputPerMillion: number
  extraBody: Record<string, unknown>
}

const ROUTES: readonly RouteSpec[] = [
  {
    route: ERoute.Inference,
    provider: EAuthProvider.Inference,
    label: 'Inference.net',
    url: 'https://api.inference.net/v1/chat/completions',
    modelId: 'kimi-k3-fast',
    inputPerMillion: 4.5,
    extraBody: {},
  },
  {
    route: ERoute.InferenceBase,
    provider: EAuthProvider.Inference,
    label: 'Inference.net (base)',
    url: 'https://api.inference.net/v1/chat/completions',
    modelId: 'kimi-k3',
    inputPerMillion: 3.95,
    extraBody: {},
  },
  {
    route: ERoute.OpenRouter,
    provider: EAuthProvider.OpenRouter,
    label: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    modelId: 'moonshotai/kimi-k3',
    inputPerMillion: 3,
    /**
     * OpenRouter omits token accounting from the response unless `usage.include` is set.
     * https://openrouter.ai/docs/use-cases/usage-accounting
     */
    extraBody: { usage: { include: true } },
  },
]

const VOCABULARY = [
  'resolve',
  'handler',
  'registry',
  'threshold',
  'adapter',
  'boundary',
  'transcript',
  'directory',
  'annotate',
  'sequence',
  'fragment',
  'assemble',
  'credential',
  'partition',
  'listener',
  'checkpoint',
]

const seededWords = (args: { seed: number; count: number }): string => {
  let state = args.seed
  const words: string[] = []
  for (let index = 0; index < args.count; index += 1) {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296
    const pick = VOCABULARY[state % VOCABULARY.length] ?? 'resolve'
    words.push(index % 12 === 11 ? `${pick}\n` : pick)
  }
  return words.join(' ')
}

const numberFlag = (args: { name: string; fallback: number }): number => {
  const raw = process.argv.find((entry) => entry.startsWith(`--${args.name}=`))
  if (raw === undefined) return args.fallback
  const parsed = Number(raw.slice(args.name.length + 3))
  return Number.isFinite(parsed) ? parsed : args.fallback
}

const routesRequested = (): readonly RouteSpec[] => {
  const raw = process.argv.find((entry) => entry.startsWith('--route='))
  if (raw === undefined) return ROUTES
  const wanted = raw.slice('--route='.length)
  return wanted === 'both' ? ROUTES : ROUTES.filter((spec) => spec.route === wanted)
}

const keyFor = async (provider: EAuthProvider): Promise<string> => {
  const clock = new SystemClock()
  const sessions = new CloudSessionStore({ file: atlasCloudFile(), keyFile: atlasVaultKeyFile() })
  const port = new BrokeredCredentialPort({
    accounts: new AccountStoreProxy({
      local: fileAccountStore({ file: atlasVaultFile(), keyFile: atlasVaultKeyFile(), clock }),
      sessions,
    }),
    sessions,
    clock,
  })
  const credential = await port.read({ provider })
  const secret = secretOf(credential)
  if (secret.length === 0) throw new Error(`no key stored for ${provider}`)
  return secret
}

type UsageShape = {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
  cache_read_input_tokens?: number
  prompt_cache_hit_tokens?: number
}

const cachedTokensOf = (usage: UsageShape): number =>
  usage.prompt_tokens_details?.cached_tokens ??
  usage.cache_read_input_tokens ??
  usage.prompt_cache_hit_tokens ??
  0

const regimeOf = (cached: number): ERegime => {
  if (cached === 0) return ERegime.Zero
  return cached % 1024 === 0 ? ERegime.Block : ERegime.Full
}

type RoundResult = {
  round: number
  promptTokens: number
  cachedTokens: number
  latencyMs: number
  regime: ERegime
}

const askOnce = async (args: {
  spec: RouteSpec
  apiKey: string
  prefix: string
  cacheKey: string
  round: number
}): Promise<RoundResult> => {
  const body = {
    model: args.spec.modelId,
    messages: [
      { role: 'system', content: 'You are a terse assistant. Reply with one word.' },
      { role: 'user', content: args.prefix },
      { role: 'assistant', content: 'Understood.' },
      { role: 'user', content: `Round ${args.round}. Reply with the word PONG.` },
    ],
    max_tokens: 8,
    temperature: 0,
    prompt_cache_key: args.cacheKey,
    ...args.spec.extraBody,
  }

  const started = performance.now()
  const response = await fetch(args.spec.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${args.apiKey}`,
      'content-type': 'application/json',
      'http-referer': 'https://github.com/comp-ai/atlas',
      'x-title': 'Atlas cache probe',
    },
    body: JSON.stringify(body),
  })
  const latencyMs = performance.now() - started

  if (!response.ok) {
    throw new Error(`${args.spec.label} ${response.status}: ${(await response.text()).slice(0, 300)}`)
  }

  const payload = (await response.json()) as { usage?: UsageShape; provider?: string; model?: string }
  const usage = payload.usage ?? {}
  if (process.argv.includes('--raw')) {
    console.log(
      `      upstream=${payload.provider ?? 'unreported'} model=${payload.model ?? '?'} usage=${JSON.stringify(usage)}`,
    )
  }
  const cachedTokens = cachedTokensOf(usage)

  return {
    round: args.round,
    promptTokens: usage.prompt_tokens ?? 0,
    cachedTokens,
    latencyMs,
    regime: regimeOf(cachedTokens),
  }
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

const runRoute = async (args: {
  spec: RouteSpec
  rounds: number
  prefix: string
  gapMs: number
  seed: number
}): Promise<void> => {
  const { spec } = args
  console.log(`\n=== ${spec.label} · ${spec.modelId} · seed ${args.seed} ===`)

  let apiKey: string
  try {
    apiKey = await keyFor(spec.provider)
  } catch (error) {
    console.log(`  skipped: ${error instanceof Error ? error.message : String(error)}`)
    return
  }

  const cacheKey = `cache-probe-${Date.now()}`
  const results: RoundResult[] = []

  for (let round = 1; round <= args.rounds; round += 1) {
    try {
      const result = await askOnce({ spec, apiKey, prefix: args.prefix, cacheKey, round })
      results.push(result)
      const pct = result.promptTokens === 0 ? 0 : (100 * result.cachedTokens) / result.promptTokens
      console.log(
        `  ${String(round).padStart(2)}  prompt ${String(result.promptTokens).padStart(7)}` +
          `  cached ${String(result.cachedTokens).padStart(7)}` +
          `  ${pct.toFixed(1).padStart(5)}%  ${result.regime.padEnd(5)}` +
          `  ${Math.round(result.latencyMs)}ms`,
      )
    } catch (error) {
      console.log(`  ${String(round).padStart(2)}  failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (round < args.rounds) await sleep(args.gapMs)
  }

  if (results.length === 0) return

  const prompt = results.reduce((sum, row) => sum + row.promptTokens, 0)
  const cached = results.reduce((sum, row) => sum + row.cachedTokens, 0)
  const counted = (regime: ERegime): number => results.filter((row) => row.regime === regime).length
  const uncached = prompt - cached
  const spend = (uncached * spec.inputPerMillion + cached * spec.inputPerMillion * 0.1) / 1_000_000

  console.log(
    `  summary: ${((100 * cached) / prompt).toFixed(1)}% cached over ${results.length} rounds` +
      ` — full ${counted(ERegime.Full)}, block ${counted(ERegime.Block)}, zero ${counted(ERegime.Zero)}`,
  )
  console.log(`  input spend this run: $${spend.toFixed(2)} (cache reads assumed at 0.1x)`)
}

const main = async (): Promise<void> => {
  const rounds = numberFlag({ name: 'rounds', fallback: 12 })
  const words = numberFlag({ name: 'words', fallback: 60_000 })
  const gapMs = numberFlag({ name: 'gap', fallback: 2_000 })
  const baseSeed = numberFlag({ name: 'seed', fallback: 20_260_916 })
  const specs = routesRequested()

  console.log(
    `probe: ${rounds} rounds, ${words} words of prefix, ${gapMs}ms apart,` +
      ' a fresh never-sent prefix and one cache key per route',
  )

  for (const [index, spec] of specs.entries()) {
    const seed = baseSeed + index * 7919
    await runRoute({ spec, rounds, gapMs, seed, prefix: seededWords({ seed, count: words }) })
  }
}

await main()
