import { afterEach, describe, expect, it } from 'bun:test'

import { EImageTier, estimateTextTokens, type ModelCard } from '@dltech/atlas-core'

import { buildHarness, ETurnStatus, type AtlasHarness } from '..'
import { scriptedModel } from '../../model/testing/scripted-model'
import { createTempHome, type TempHome } from './temp-home'

const opened: { harness: AtlasHarness; temp: TempHome }[] = []

const HAIKU_WINDOW = 200_000

const HAIKU_CARD: ModelCard = {
  ref: { providerId: 'anthropic', modelId: 'claude-haiku-4-5' },
  label: 'haiku-4-5',
  api: 'anthropic',
  contextWindow: HAIKU_WINDOW,
  imageTier: EImageTier.Standard,
}

const HUGE = 'x'.repeat(4 * (HAIKU_WINDOW + 10_000))

async function open(): Promise<AtlasHarness> {
  const temp = createTempHome()
  const harness = await buildHarness({
    home: temp.home,
    model: scriptedModel({ script: [{ text: 'done' }] }),
    identity: { id: 'anthropic', modelId: 'claude-haiku-4-5' },
    card: HAIKU_CARD,
  })
  opened.push({ harness, temp })
  return harness
}

afterEach(async () => {
  for (const entry of opened.splice(0)) {
    await entry.harness.close()
    entry.temp.discard()
  }
})

describe('a prompt our own arithmetic prices past the window', () => {
  it('is still sent, because only the provider knows what its window holds', async () => {
    expect(estimateTextTokens(HUGE)).toBeGreaterThan(HAIKU_WINDOW)

    const harness = await open()
    const thread = await harness.threads.create({})

    const outcome = await harness.runner.say({ threadId: thread.id, text: HUGE })

    expect(outcome.status).toBe(ETurnStatus.Completed)
  }, 30_000)
})
