import { describe, expect, it, vi } from 'vitest'
import type { EnvService } from '../../../_core/config/env/env.service'
import type { OrgSettingsService } from '../settings/org-settings.service'
import { BotRelevanceClassifier } from './bot-relevance.classifier'

function fakeEnv(args: { apiKey?: string; modelId?: string }): EnvService {
  return {
    get: (key: string) => {
      if (key === 'FACTORY_MODEL_API_KEY') return args.apiKey
      if (key === 'FACTORY_MODEL_ID') return args.modelId
      return undefined
    },
  } as unknown as EnvService
}

describe('BotRelevanceClassifier', () => {
  const settings = {
    readModelCredential: vi.fn(
      async (): Promise<{ provider: string; apiKey: string; modelRef: string } | null> => null,
    ),
  }

  it('wakes when the classifier says the engineer needs the comment', async () => {
    const classify = vi.fn(async () => ({ needsAgent: true }))
    const classifier = new BotRelevanceClassifier(
      fakeEnv({ apiKey: 'key' }),
      settings as unknown as OrgSettingsService,
    )
    classifier.classify = classify

    expect(
      await classifier.shouldWake({ organizationId: null, author: 'cubic-dev-ai[bot]', body: 'found a P1' }),
    ).toBe(true)
  })

  it('suppresses the wake when the classifier says the comment is noise', async () => {
    const classify = vi.fn(async () => ({ needsAgent: false }))
    const classifier = new BotRelevanceClassifier(
      fakeEnv({ apiKey: 'key' }),
      settings as unknown as OrgSettingsService,
    )
    classifier.classify = classify

    expect(
      await classifier.shouldWake({ organizationId: null, author: 'vercel[bot]', body: 'deployment succeeded' }),
    ).toBe(false)
  })

  it('fails open when the classifier throws', async () => {
    const classify = vi.fn(async () => {
      throw new Error('model unreachable')
    })
    const classifier = new BotRelevanceClassifier(
      fakeEnv({ apiKey: 'key' }),
      settings as unknown as OrgSettingsService,
    )
    classifier.classify = classify

    expect(
      await classifier.shouldWake({ organizationId: null, author: 'vercel[bot]', body: 'x' }),
    ).toBe(true)
  })

  it('wakes when there is no credential to classify with', async () => {
    const classifier = new BotRelevanceClassifier(
      fakeEnv({}),
      settings as unknown as OrgSettingsService,
    )

    expect(
      await classifier.shouldWake({ organizationId: null, author: 'vercel[bot]', body: 'x' }),
    ).toBe(true)
  })

  it('uses the organization model credential when one is stored', async () => {
    settings.readModelCredential.mockResolvedValueOnce({
      provider: 'anthropic',
      apiKey: 'org-key',
      modelRef: 'anthropic/claude-haiku-4-5',
    })
    const classify = vi.fn(async () => ({ needsAgent: true }))
    const classifier = new BotRelevanceClassifier(
      fakeEnv({}),
      settings as unknown as OrgSettingsService,
    )
    classifier.classify = classify

    await classifier.shouldWake({ organizationId: 'org_1', author: 'vercel[bot]', body: 'x' })

    expect(classify).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'org-key', modelId: 'claude-haiku-4-5' }),
    )
  })
})
