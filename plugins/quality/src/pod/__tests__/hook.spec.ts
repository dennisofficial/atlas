import { describe, expect, it } from 'bun:test'

import { EQualityReviewStatus } from '@dltech/atlas-core'

import {
  CALL,
  createRig,
  failed,
  readCall,
  recordsOf,
  wroteNothing,
  wroteWithChanges,
  writeCall,
} from './support'

describe('capture predicate', () => {
  it('asks for captured text on a write while the classifier and the setting are on', async () => {
    expect(await createRig().captures(writeCall())).toBe(true)
  })

  it('asks for nothing when the classifier is off', async () => {
    expect(await createRig({ classifierOn: false }).captures(writeCall())).toBe(false)
  })

  it('asks for nothing when the quality setting is off', async () => {
    const rig = createRig({ settings: { enabled: false, policies: {}, examples: false } })
    expect(await rig.captures(writeCall())).toBe(false)
  })

  it('asks for nothing on a read call', async () => {
    expect(await createRig().captures(readCall())).toBe(false)
  })
})

describe('reviewing a write', () => {
  it('returns the review record and the finding as keyed context of that call', async () => {
    const rig = createRig()

    const outcome = await rig.run()
    const drafts = outcome.drafts ?? []

    expect(recordsOf(drafts)).toHaveLength(1)
    expect(drafts).toHaveLength(1)
    expect(recordsOf(drafts)[0]).toMatchObject({
      callId: CALL,
      status: EQualityReviewStatus.Completed,
    })
    expect(outcome.contextKey).toBe(CALL)
    expect(outcome.additionalContext).toContain('Code quality note')
    expect(outcome.additionalContext).toContain('Widget')
    expect(rig.classifyCalls).toHaveLength(1)
    expect(rig.logs).toEqual([])
  })

  it('returns nothing when the write captured no change', async () => {
    const rig = createRig()
    expect(await rig.run({ result: wroteNothing() })).toEqual({})
    expect(rig.classifyCalls).toHaveLength(0)
  })

  it('returns nothing for a failed result', async () => {
    const rig = createRig()
    expect(await rig.run({ result: failed() })).toEqual({})
    expect(rig.classifyCalls).toHaveLength(0)
  })

  it('returns nothing when the setting went off between capture and run', async () => {
    const rig = createRig()
    rig.settings.enabled = false
    expect(await rig.run({ result: wroteWithChanges() })).toEqual({})
    expect(rig.classifyCalls).toHaveLength(0)
  })

  it('returns nothing when the classifier went off between capture and run', async () => {
    const rig = createRig()
    const off = createRig({ classifierOn: false })
    expect(await off.run({ result: wroteWithChanges() })).toEqual({})
    expect(off.classifyCalls).toHaveLength(0)
    expect(rig.hook.name).toBe('quality-review')
  })
})
