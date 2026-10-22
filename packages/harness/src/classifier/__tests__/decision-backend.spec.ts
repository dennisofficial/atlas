import { ATLAS_SETTINGS, ESettingId, jevRiskQuestions } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { MemorySecretsStore } from '../../secrets/memory-store'
import { MemorySettingsStore } from '../../settings/memory-store'
import { createSettingsService } from '../../settings/service'
import { createDecisionClient, liveDecisionsEndpoint } from '../decision-backend'

const rig = (values: Record<string, string>, secrets: Record<string, string> = {}) => {
  const settings = createSettingsService({
    definitions: ATLAS_SETTINGS,
    user: new MemorySettingsStore({ document: { values } }),
  })
  return { settings, secrets: new MemorySecretsStore({ secrets }) }
}

const OPENAI_BODY = { model: 'gpt-6-luna', answers: [{ type: 'predicate', name: 'danger', probability: 0.4 }] }

const withFetch = async (
  respond: (url: string, init: RequestInit) => Response,
  run: (seen: { url: string; init: RequestInit }[]) => Promise<void>,
): Promise<void> => {
  const seen: { url: string; init: RequestInit }[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input)
    seen.push({ url, init: init ?? {} })
    return respond(url, init ?? {})
  }) as typeof fetch
  try {
    await run(seen)
  } finally {
    globalThis.fetch = original
  }
}

const ask = (client: ReturnType<typeof createDecisionClient>) =>
  client.decide({ state: 's', questions: jevRiskQuestions(), signal: AbortSignal.timeout(5000) })

describe('liveDecisionsEndpoint', () => {
  it('reads the key of the selected provider only', () => {
    const { settings, secrets } = rig(
      { [ESettingId.DecisionsProvider]: 'openai' },
      { 'decisions.token.openai': 'sk-o', 'decisions.token.typesafe': 'sk-t' },
    )
    const live = liveDecisionsEndpoint({ settings, secrets })()

    expect(live?.token).toBe('sk-o')
    expect(live?.endpoint.tokenName).toBe('decisions.token.openai')
  })

  it('follows a provider switch without being rebuilt', () => {
    const { settings, secrets } = rig({}, { 'decisions.token.typesafe': 'a', 'decisions.token.vercel': 'b' })
    const live = liveDecisionsEndpoint({ settings, secrets })

    expect(live()?.endpoint.url).toBe('https://api.typesafe.ai')
    settings.set({ id: ESettingId.DecisionsProvider, value: 'vercel' })
    expect(live()?.endpoint.url).toBe('https://ai-gateway.vercel.sh/typesafe')
  })

  it('is null on an unconfigured provider', () => {
    const { settings, secrets } = rig({})
    expect(liveDecisionsEndpoint({ settings, secrets })()).toBeNull()
  })
})

describe('createDecisionClient', () => {
  it('answers the not-set fault when nothing is configured', async () => {
    const { settings, secrets } = rig({})
    const outcome = await ask(createDecisionClient({ settings, secrets }))

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.fault).toContain('not set')
  })

  it('sends openai provider calls to /v1/decisions with the translated body and bearer key', async () => {
    const { settings, secrets } = rig(
      { [ESettingId.DecisionsProvider]: 'openai' },
      { 'decisions.token.openai': 'sk-o' },
    )
    await withFetch(
      () => new Response(JSON.stringify(OPENAI_BODY)),
      async (seen) => {
        const outcome = await ask(createDecisionClient({ settings, secrets }))

        expect(outcome).toEqual({ ok: true, answers: { danger: { noul: 0.4 } }, model: 'gpt-6-luna' })
        expect(seen).toHaveLength(1)
        expect(seen[0]?.url).toBe('https://api.openai.com/v1/decisions')
        expect((seen[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-o')
        const body = JSON.parse(String(seen[0]?.init.body)) as { model: string; input: string; questions: { type: string }[] }
        expect(body.model).toBe('gpt-6-luna')
        expect(body.input).toBe('s')
        expect(body.questions[0]?.type).toBe('predicate')
      },
    )
  })

  it('sends jev provider calls down the Jev route, not /v1/decisions', async () => {
    const { settings, secrets } = rig({}, { 'decisions.token.typesafe': 'sk-t' })
    await withFetch(
      () => new Response('{}', { status: 500 }),
      async (seen) => {
        await ask(createDecisionClient({ settings, secrets }))

        expect(seen.length).toBeGreaterThan(0)
        expect(seen.every((call) => call.url.startsWith('https://api.typesafe.ai') && call.url.includes('systemone'))).toBe(
          true,
        )
      },
    )
  })

  it('routes a custom provider over the Jev protocol to the configured url', async () => {
    const { settings, secrets } = rig({
      [ESettingId.DecisionsProvider]: 'custom',
      [ESettingId.DecisionsUrl]: 'http://laya.local:8080',
    })
    await withFetch(
      () => new Response('{}', { status: 500 }),
      async (seen) => {
        await ask(createDecisionClient({ settings, secrets }))

        expect(seen.every((call) => call.url.startsWith('http://laya.local:8080/v1/systemone'))).toBe(true)
      },
    )
  })
})
