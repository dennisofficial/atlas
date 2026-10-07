import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { ESettingId, EQualityReviewStatus, QualityReviewPort } from '@dltech/atlas-core'

import { portToken } from '../../container/injection'
import { CodeQualityReview } from '../../quality/engine'
import { FakeDecisions, QualityRig, WIDGET_SOURCE, typesOf } from './quality-test-fixtures'

const POLICY_SETTING = 'quality.policies.singleResponsibility'
const SRP_CONCERN_KEY = 'single-responsibility:currentConcern'

let rig: QualityRig

beforeEach(async () => {
  rig = await QualityRig.create({ command: 'atlas-test' })
})

afterEach(async () => {
  await rig.dispose()
})

const reviewedStatuses = (drafts: Awaited<ReturnType<QualityRig['dispatchWrite']>>): EQualityReviewStatus[] =>
  drafts.flatMap((draft) => (draft.type === 'code-quality-reviewed' ? [draft.status] : []))

describe('bindQuality in the shared root', () => {
  it('registers the quality port after the DecisionPort and before the surface binds, and descriptors reach settings', () => {
    expect(rig.facts).toEqual({ decisionPortWasRegistered: true, qualityPortWasRegistered: true })
    expect(rig.container.resolve(portToken(QualityReviewPort))).toBeInstanceOf(CodeQualityReview)

    const definition = rig.app.settings.definitions.find((one) => one.id === POLICY_SETTING)
    expect(definition?.fallback).toBe(true)
    expect(rig.app.settings.definitions.some((one) => one.id === ESettingId.QualityEnabled)).toBe(true)
  })

  it('stays off by default: no decision call, no review record, the write still lands', async () => {
    const threadId = await rig.newThread()
    const port = rig.container.resolve(portToken(QualityReviewPort))
    expect(port.captureEnabled()).toBe(false)

    const drafts = await rig.dispatchWrite({ threadId, relative: 'off.ts', content: WIDGET_SOURCE })

    expect(typesOf(drafts)).toEqual(['tool-result'])
    expect(rig.decisions.calls).toHaveLength(0)
    expect(await rig.onDisk('off.ts')).toBe(WIDGET_SOURCE)
    expect(await rig.exampleFiles(threadId)).toEqual([])
  })

  it('reviews through the real SRP policy and source adapter once the master setting is on', async () => {
    const threadId = await rig.newThread()
    rig.enableReview()

    const drafts = await rig.dispatchWrite({ threadId, relative: 'widget.ts', content: WIDGET_SOURCE })

    expect(typesOf(drafts)).toEqual(['tool-result', 'code-quality-reviewed', 'nudge'])
    expect(rig.decisions.calls[0]?.questionKeys).toContain(SRP_CONCERN_KEY)
    const record = drafts.find((draft) => draft.type === 'code-quality-reviewed')
    if (record?.type !== 'code-quality-reviewed') throw new Error('no review record')
    expect(record.status).toBe(EQualityReviewStatus.Completed)
    expect(record.scope?.path).toBe('widget.ts')
    expect(record.workspaceNamespace).toStartWith('local:')
    expect(await rig.onDisk('widget.ts')).toBe(WIDGET_SOURCE)
  })

  it('follows live master and policy toggles without recomposing', async () => {
    const threadId = await rig.newThread()
    rig.enableReview()
    await rig.dispatchWrite({ threadId, relative: 'a.ts', content: WIDGET_SOURCE })
    const afterFirst = rig.decisions.calls.length
    expect(afterFirst).toBeGreaterThan(0)

    rig.setting({ id: POLICY_SETTING, value: false })
    const policyOff = await rig.dispatchWrite({ threadId, relative: 'b.ts', content: WIDGET_SOURCE })
    expect(rig.decisions.calls).toHaveLength(afterFirst)
    expect(typesOf(policyOff)).not.toContain('nudge')

    rig.setting({ id: POLICY_SETTING, value: true })
    await rig.dispatchWrite({ threadId, relative: 'c.ts', content: WIDGET_SOURCE })
    expect(rig.decisions.calls.length).toBeGreaterThan(afterFirst)

    const before = rig.decisions.calls.length
    rig.setting({ id: ESettingId.QualityEnabled, value: false })
    const masterOff = await rig.dispatchWrite({ threadId, relative: 'd.ts', content: WIDGET_SOURCE })
    expect(rig.decisions.calls).toHaveLength(before)
    expect(typesOf(masterOff)).toEqual(['tool-result'])
  })

  it('records a transport fault as an operational record while the write still succeeds', async () => {
    const threadId = await rig.newThread()
    rig.enableReview()
    rig.decisions.mode = 'fault'

    const drafts = await rig.dispatchWrite({ threadId, relative: 'fault.ts', content: WIDGET_SOURCE })

    expect(reviewedStatuses(drafts)).not.toContain(EQualityReviewStatus.Completed)
    expect(typesOf(drafts)).not.toContain('nudge')
    expect(await rig.onDisk('fault.ts')).toBe(WIDGET_SOURCE)
    expect(rig.decisions).toBeInstanceOf(FakeDecisions)
  })
})
