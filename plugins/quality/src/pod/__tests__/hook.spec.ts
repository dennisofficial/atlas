import { describe, expect, it } from 'bun:test'

import {
  EClassifierFault,
  EQualityReviewStatus,
  type ClassifierOutcome,
  type HookOutcome,
} from '@dltech/atlas-core'

import { JEV_QUALITY_MODEL } from '../../review/request'
import {
  CALL,
  createRig,
  failed,
  historyOf,
  readCall,
  recordsOf,
  wroteNothing,
  wroteWithChanges,
  writeCall,
  type ClassifyArgs,
} from './support'

const notesOf = (outcome: HookOutcome) =>
  (outcome.drafts ?? []).flatMap((draft) => (draft.type === 'context-loaded' ? [draft] : []))

const earlierNote = (key: string) =>
  historyOf([
    {
      type: 'context-loaded',
      slot: 'quality-review',
      key,
      content: 'an earlier note for the file',
    },
  ])

const undecided = async (args: ClassifyArgs): Promise<ClassifierOutcome> => ({
  ok: true,
  model: JEV_QUALITY_MODEL,
  answers: Object.fromEntries(
    Object.entries(args.questions).map(([name, question]) => [
      name,
      question.type === 'noul'
        ? { noul: 0.5 }
        : { choice: Object.keys(question.criteria)[0] ?? name, confidence: 0.9 },
    ]),
  ),
})

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
  it('returns the review record and one note keyed by the reviewed file', async () => {
    const rig = createRig()

    const outcome = await rig.run()
    const drafts = outcome.drafts ?? []
    const notes = notesOf(outcome)

    expect(recordsOf(drafts)).toHaveLength(1)
    expect(drafts).toHaveLength(2)
    expect(recordsOf(drafts)[0]).toMatchObject({
      callId: CALL,
      status: EQualityReviewStatus.Completed,
    })
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ slot: 'quality-review', key: 'src/widget.ts' })
    expect(notes[0]?.content).toContain('Code quality note')
    expect(notes[0]?.content).toContain('Widget')
    expect(rig.classifyCalls).toHaveLength(1)
    expect(rig.logs).toEqual([])
  })

  it('retires an earlier note for a file that a later review found nothing to say about', async () => {
    const rig = createRig({ classify: undecided, events: earlierNote('src/widget.ts') })

    const notes = notesOf(await rig.run())

    expect(notes).toEqual([
      { type: 'context-loaded', slot: 'quality-review', key: 'src/widget.ts', content: '' },
    ])
  })

  it('leaves the earlier note in place when this review found something in the same file', async () => {
    const rig = createRig({ events: earlierNote('src/widget.ts') })

    const notes = notesOf(await rig.run())

    expect(notes).toHaveLength(1)
    expect(notes[0]?.key).toBe('src/widget.ts')
    expect(notes[0]?.content).toContain('Code quality note')
  })

  it('leaves the earlier note in place when the review did not complete', async () => {
    const rig = createRig({
      classify: async () => ({
        ok: false,
        fault: EClassifierFault.Unavailable,
        detail: 'timeout',
      }),
      events: earlierNote('src/widget.ts'),
    })

    const outcome = await rig.run()

    expect(notesOf(outcome)).toEqual([])
    expect(outcome.drafts).toHaveLength(1)
  })

  it('leaves the note of another file alone', async () => {
    const rig = createRig({ events: earlierNote('src/other.ts') })

    const notes = notesOf(await rig.run())

    expect(notes.map((note) => note.key)).toEqual(['src/widget.ts'])
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
