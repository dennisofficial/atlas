import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { EQualitySkipReason, ESettingId } from '@dltech/atlas-core'

import { QualityRig, WIDGET_SOURCE, typesOf } from './quality-test-fixtures'

let rig: QualityRig

beforeEach(async () => {
  rig = await QualityRig.create({ command: 'atlas-test' })
})

afterEach(async () => {
  await rig.dispose()
})

describe('quality example recording through the shared root', () => {
  it('writes nothing under the thread directory until the examples setting is on', async () => {
    const threadId = await rig.newThread()
    rig.enableReview()

    await rig.dispatchWrite({ threadId, relative: 'a.ts', content: WIDGET_SOURCE })

    expect(await rig.exampleFiles(threadId)).toEqual([])
  })

  it('records an example under the thread data path with review off, and never calls the decision model', async () => {
    const threadId = await rig.newThread()
    rig.setting({ id: ESettingId.QualityRecordExamples, value: true })

    const drafts = await rig.dispatchWrite({ threadId, relative: 'a.ts', content: WIDGET_SOURCE })

    const files = await rig.exampleFiles(threadId)
    expect(files).toHaveLength(1)
    expect(files[0]).toContain(`threads/${threadId}/quality/examples/`)
    expect(rig.decisions.calls).toHaveLength(0)
    expect(typesOf(drafts)).toEqual(['tool-result', 'code-quality-reviewed'])
    const record = drafts[1]
    if (record?.type !== 'code-quality-reviewed') throw new Error('no review record')
    expect(record.reason).toBe(EQualitySkipReason.Disabled)
    expect(record.evidencePath).toContain(`threads/${threadId}/quality/examples/`)
    expect(await rig.onDisk('a.ts')).toBe(WIDGET_SOURCE)
  })

  it('records examples alongside a live review when both settings are on', async () => {
    const threadId = await rig.newThread()
    rig.enableReview()
    rig.setting({ id: ESettingId.QualityRecordExamples, value: true })

    const drafts = await rig.dispatchWrite({ threadId, relative: 'a.ts', content: WIDGET_SOURCE })

    expect(await rig.exampleFiles(threadId)).toHaveLength(1)
    expect(typesOf(drafts)).toContain('nudge')
  })
})
