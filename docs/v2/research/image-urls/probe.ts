import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'

import type { LanguageModelV4, LanguageModelV4Prompt } from '@ai-sdk/provider'
import { EAuthKind, toAccountId, type Credential } from '@dltech/atlas-core'

import { createOpenAiModel } from '../../../packages/harness/src/providers/openai-oauth'
import { createAnthropicOauthModel } from '../src/model/anthropic-oauth'
import { activeConnectionId, heldTokens, pool } from './creds'

const blob = (await import(
  '/atlas/workspaces/atlas/apps/api/node_modules/@vercel/blob'
)) as typeof import('/atlas/workspaces/atlas/apps/api/node_modules/@vercel/blob')
const sharp = (
  await import(
    '/atlas/workspaces/atlas/node_modules/.bun/sharp@0.35.4+74919bda79eae746/node_modules/sharp'
  )
).default

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN ?? ''
if (!BLOB_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN unset')
const OUT = process.env.SPIKE_OUT ?? '/tmp/spike-image-urls'
mkdirSync(OUT, { recursive: true })

const codeWord = `KESTREL-${(randomBytes(2).readUInt16BE(0) % 9000) + 1000}`
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
<rect width="100%" height="100%" fill="#f4f1ea"/>
<text x="80" y="200" font-family="DejaVu Sans" font-size="48" fill="#333">Atlas image URL spike</text>
<text x="80" y="420" font-family="DejaVu Sans Mono" font-size="96" fill="#b3261e">${codeWord}</text>
<circle cx="1000" cy="620" r="110" fill="#2e6bd6"/></svg>`
const png = await sharp(Buffer.from(svg)).png().toBuffer()
writeFileSync(`${OUT}/image.png`, png)

const pathname = `spike/image-urls/${randomBytes(6).toString('hex')}.png`
await blob.put(pathname, png, {
  access: 'private',
  token: BLOB_TOKEN,
  contentType: 'image/png',
  addRandomSuffix: false,
})

const sign = async (ttlMs: number): Promise<string> => {
  const validUntil = Date.now() + ttlMs
  const signed = await blob.issueSignedToken({
    token: BLOB_TOKEN,
    pathname,
    operations: ['get'],
    validUntil,
  })
  const { presignedUrl } = await blob.presignUrl(signed, {
    operation: 'get',
    pathname,
    access: 'private',
    validUntil,
  })
  return presignedUrl
}

const log: unknown[] = []
const note = (entry: Record<string, unknown>) => {
  log.push(entry)
  console.log(JSON.stringify(entry))
}

const shapeOf = (url: string) => {
  const parsed = new URL(url)
  return {
    host: parsed.host,
    path: parsed.pathname,
    queryKeys: [...parsed.searchParams.keys()],
    length: url.length,
  }
}

const probeFetch = async (url: string) => {
  const response = await fetch(url, { redirect: 'manual' })
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    location: response.headers.get('location'),
  }
}

const urlA = await sign(10 * 60_000)
const urlB = await sign(10 * 60_000)
note({
  step: 'signed',
  codeWord,
  pathname,
  bytes: png.length,
  shapeA: shapeOf(urlA),
  sameUrlWhenResigned: urlA === urlB,
  podFetch: await probeFetch(urlA),
})

const filler = Array.from(
  { length: 900 },
  (_, i) => `Rule ${i}: keep tool output terse and cite the file path you read before you edit it.`,
).join('\n')
const SYSTEM = `You are a careful assistant in a prompt-caching experiment.\n${filler}`
const QUESTION = 'What is the code word printed in red in the image? Reply with the code word only.'

type ImageSource = { kind: 'url'; url: string } | { kind: 'base64' }

const imagePart = (source: ImageSource, cache: boolean) => ({
  type: 'file' as const,
  mediaType: 'image/png',
  data:
    source.kind === 'url'
      ? { type: 'url' as const, url: new URL(source.url) }
      : { type: 'data' as const, data: png.toString('base64') },
  ...(cache
    ? {
        providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
      }
    : {}),
})

const promptFor = (args: {
  source: ImageSource
  withSystem: boolean
  cache: boolean
}): LanguageModelV4Prompt => [
  ...(args.withSystem ? [{ role: 'system' as const, content: SYSTEM }] : []),
  {
    role: 'user',
    content: [{ type: 'text', text: QUESTION }, imagePart(args.source, args.cache)],
  },
]

const run = async (args: {
  provider: string
  label: string
  model: LanguageModelV4
  source: ImageSource
  withSystem: boolean
  cache: boolean
  providerOptions?: Record<string, Record<string, unknown>>
}) => {
  const started = Date.now()
  try {
    const { stream } = await args.model.doStream({
      prompt: promptFor(args),
      maxOutputTokens: 200,
      ...(args.providerOptions === undefined
        ? {}
        : { providerOptions: args.providerOptions as never }),
    })
    let text = ''
    let usage: unknown
    let error: unknown
    const reader = stream.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value.type === 'text-delta') text += value.delta
      if (value.type === 'finish') usage = value.usage
      if (value.type === 'error')
        error = String((value.error as { message?: string })?.message ?? value.error).slice(0, 400)
    }
    note({
      provider: args.provider,
      step: args.label,
      ms: Date.now() - started,
      answer: text.trim(),
      correct: text.includes(codeWord),
      usage,
      error,
    })
  } catch (caught) {
    const failure = caught as {
      statusCode?: number
      responseBody?: string
      message?: string
    }
    note({
      provider: args.provider,
      step: args.label,
      ms: Date.now() - started,
      failed: true,
      status: failure.statusCode,
      body: (failure.responseBody ?? failure.message ?? '').slice(0, 600),
    })
  }
}

const anthropicTokens = await heldTokens(await activeConnectionId('anthropic'))
const openaiTokens = await heldTokens(await activeConnectionId('openai'))

const portFor = (credential: Credential) => ({
  read: async () => credential,
  discard: async () => {},
})

const anthropic = createAnthropicOauthModel({
  credentials: portFor({
    kind: EAuthKind.Oauth,
    accountId: toAccountId('spike-anthropic'),
    accessToken: anthropicTokens.accessToken,
    expiresAt: anthropicTokens.expiresAt,
  }) as never,
  modelId: process.env.SPIKE_ANTHROPIC_MODEL ?? 'claude-haiku-4-5',
})

const codex = createOpenAiModel({
  credentials: portFor({
    kind: EAuthKind.Oauth,
    accountId: toAccountId('spike-openai'),
    accessToken: openaiTokens.accessToken,
    expiresAt: openaiTokens.expiresAt,
    providerAccountId: openaiTokens.accountId,
  }) as never,
  providerId: 'openai',
  modelId: process.env.SPIKE_OPENAI_MODEL ?? 'gpt-5.5',
})
const codexOptions = {
  openai: {
    instructions: SYSTEM,
    promptCacheKey: `spike-${randomBytes(6).toString('hex')}`,
  },
}

const urlE = await sign(40_000)
const urlF = await sign(40_000)
const expiresAt = Date.now() + 40_000

const sequence = async (provider: 'anthropic' | 'openai') => {
  const base =
    provider === 'anthropic'
      ? { provider, model: anthropic, withSystem: true, cache: true }
      : {
          provider,
          model: codex,
          withSystem: false,
          cache: false,
          providerOptions: codexOptions,
        }
  await run({
    ...base,
    label: '1 url A (cold)',
    source: { kind: 'url', url: urlA },
  })
  await run({
    ...base,
    label: '2 url A (repeat)',
    source: { kind: 'url', url: urlA },
  })
  await run({
    ...base,
    label: '3 url B (re-signed, same bytes)',
    source: { kind: 'url', url: urlB },
  })
  await run({
    ...base,
    label: '4 base64 (same bytes)',
    source: { kind: 'base64' },
  })
  await run({
    ...base,
    label: '5 url E (short-lived, valid)',
    source: { kind: 'url', url: urlE },
  })
}

await sequence('anthropic')
await sequence('openai')

const wait = expiresAt + 10_000 - Date.now()
if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
note({
  step: 'url E after expiry, pod fetch',
  podFetch: await probeFetch(urlE),
})
await run({
  provider: 'anthropic',
  label: '6 url E (expired)',
  model: anthropic,
  withSystem: true,
  cache: true,
  source: { kind: 'url', url: urlE },
})
await run({
  provider: 'openai',
  label: '6 url E (expired)',
  model: codex,
  withSystem: false,
  cache: false,
  providerOptions: codexOptions,
  source: { kind: 'url', url: urlE },
})
await run({
  provider: 'anthropic',
  label: '7 url F (expired, never fetched)',
  model: anthropic,
  withSystem: true,
  cache: true,
  source: { kind: 'url', url: urlF },
})
await run({
  provider: 'openai',
  label: '7 url F (expired, never fetched)',
  model: codex,
  withSystem: false,
  cache: false,
  providerOptions: codexOptions,
  source: { kind: 'url', url: urlF },
})
await run({
  provider: 'anthropic',
  label: '8 url F (expired), no system prefix',
  model: anthropic,
  withSystem: false,
  cache: false,
  source: { kind: 'url', url: urlF },
})

await blob.del([pathname], { token: BLOB_TOKEN })
note({ step: 'cleanup', deleted: pathname })
writeFileSync(`${OUT}/results.json`, JSON.stringify(log, null, 2))
await pool.end()
