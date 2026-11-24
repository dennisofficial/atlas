import { describe, expect, it } from 'bun:test'

import { EQualityFindingState, EQualityReviewStatus, EQualitySkipReason } from '@dltech/atlas-core'

import type { HookOutcome } from '@dltech/atlas-core'

import { changesUnder, createRig, historyOf, recordsOf, wroteWithChanges } from './support'

const notesOf = (outcome: HookOutcome) =>
  (outcome.drafts ?? []).flatMap((draft) => (draft.type === 'context-loaded' ? [draft] : []))

describe('workspace namespace', () => {
  it('stamps every record with the project directory the hook was given', async () => {
    const rig = createRig()
    const records = recordsOf((await rig.run()).drafts ?? [])

    expect(records.length).toBeGreaterThan(0)
    for (const record of records) expect(record.workspaceNamespace).toBe('/repo')
  })

  it('keeps a second review of the same directory on the first review ledger', async () => {
    const first = createRig()
    const firstOutcome = await first.run()
    expect(notesOf(firstOutcome)).toHaveLength(1)

    const second = createRig({ events: historyOf(firstOutcome.drafts ?? []) })
    const secondOutcome = await second.run()

    const [record] = recordsOf(secondOutcome.drafts ?? [])
    expect(record).toMatchObject({
      status: EQualityReviewStatus.Completed,
      workspaceNamespace: '/repo',
    })
    expect(record?.findings).toHaveLength(1)
    expect(record?.findings[0]).toMatchObject({
      episode: 1,
      state: EQualityFindingState.Active,
      notified: true,
    })
    expect(notesOf(secondOutcome)).toEqual([])
  })

  it('starts a new ledger for a different directory', async () => {
    const first = createRig()
    const drafts = (await first.run()).drafts ?? []

    const elsewhere = createRig({ events: historyOf(drafts) })
    const outcome = await elsewhere.run({
      projectDirectory: '/other',
      result: wroteWithChanges({ fileChanges: [changesUnder('/other')] }),
    })

    const [record] = recordsOf(outcome.drafts ?? [])
    expect(record?.workspaceNamespace).toBe('/other')
    expect(notesOf(outcome)).toHaveLength(1)
  })

  it('reviews a directory that is not a git repository', async () => {
    const rig = createRig()
    const outcome = await rig.run({
      projectDirectory: '/tmp/no-repository',
      result: wroteWithChanges({ fileChanges: [changesUnder('/tmp/no-repository')] }),
    })

    const records = recordsOf(outcome.drafts ?? [])
    expect(records.some((record) => record.status === EQualityReviewStatus.Completed)).toBe(true)
    expect(
      records.some((record) => record.reason === EQualitySkipReason.WorkspaceUnidentified),
    ).toBe(false)
  })
})
