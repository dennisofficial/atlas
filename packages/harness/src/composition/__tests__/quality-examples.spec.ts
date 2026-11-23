import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { ESettingId } from '@dltech/atlas-core'

import { QualityRig, WIDGET_SOURCE, typesOf } from './quality-test-fixtures'

let rig: QualityRig

beforeEach(async () => {
  rig = await QualityRig.create({ command: 'atlas-test' })
})

afterEach(async () => {
  await rig.dispose()
})

describe('quality example recording through the shared root', () => {
  it('exposes no examples setting, so a live review records no example file', async () => {
    const threadId = await rig.newThread()

    const drafts = await rig.dispatchWrite({ threadId, relative: 'a.ts', content: WIDGET_SOURCE })

    expect(
      rig.app.settings.definitions.some((one) => one.id === ESettingId.QualityRecordExamples),
    ).toBe(false)
    expect(typesOf(drafts)).toContain('nudge')
    expect(await rig.exampleFiles(threadId)).toEqual([])
  })
})
