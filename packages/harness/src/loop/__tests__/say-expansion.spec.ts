import { afterEach, describe, expect, it } from 'bun:test'

import { EContextSlot } from '@dltech/atlas-core'

import { buildHarness, type AtlasHarness } from '..'
import { scriptedModel } from '../../model/testing/scripted-model'
import { createTempHome, type TempHome } from './temp-home'

const opened: { harness: AtlasHarness; temp: TempHome }[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) {
    await entry.harness.close()
    entry.temp.discard()
  }
})

describe('say with an expander', () => {
  it('logs the expanded skill context before the operator message', async () => {
    const temp = createTempHome()
    const harness = await buildHarness({
      home: temp.home,
      model: scriptedModel({ script: [{ text: 'done' }] }),
      expandContext: ({ text }) => [
        { type: 'context-loaded', slot: EContextSlot.Skill, key: 'review', content: text },
      ],
    })
    opened.push({ harness, temp })
    const thread = await harness.threads.create({})

    await harness.runner.say({ threadId: thread.id, text: '/review' })

    const types = (await harness.log.read({ threadId: thread.id })).map((e) => e.type)
    expect(types.indexOf('context-loaded')).toBeGreaterThanOrEqual(0)
    expect(types.indexOf('context-loaded')).toBeLessThan(types.indexOf('user-said'))
  }, 30_000)
})
