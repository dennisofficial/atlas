import { describe, expect, it } from 'vitest'

import { EPublishStatus, hasChanges, pendingRows, planPush, stateAfterPush } from '../publish-plan'
import { EMPTY_PUBLISH_STATE, type PublishState } from '../publish-state'
import { EPublishKind, type Publishable } from '../publishables'

const item = (id: string, hash: string): Publishable => ({
  id,
  kind: EPublishKind.Skill,
  label: id,
  files: [],
  bytes: 1,
  hash,
})

const last: PublishState = {
  version: 2,
  items: {
    kept: { selected: true, hash: 'a' },
    skipped: { selected: false, hash: 'b' },
    edited: { selected: false, hash: 'old' },
    editedOn: { selected: true, hash: 'old' },
  },
}

describe('planPush', () => {
  it('selects everything new on a first push', () => {
    const plan = planPush({ items: [item('x', '1')], last: EMPTY_PUBLISH_STATE })
    expect(plan.rows).toEqual([{ item: item('x', '1'), status: EPublishStatus.New, selected: true }])
  })

  it('carries the last choice for unchanged and changed rows', () => {
    const plan = planPush({
      items: [item('kept', 'a'), item('skipped', 'b'), item('edited', 'new'), item('editedOn', 'new'), item('fresh', 'z')],
      last,
    })
    expect(plan.rows.map((row) => [row.item.id, row.status, row.selected])).toEqual([
      ['kept', EPublishStatus.Unchanged, true],
      ['skipped', EPublishStatus.Unchanged, false],
      ['edited', EPublishStatus.Changed, false],
      ['editedOn', EPublishStatus.Changed, true],
      ['fresh', EPublishStatus.New, true],
    ])
    expect(pendingRows(plan).map((row) => row.item.id)).toEqual(['edited', 'editedOn', 'fresh'])
  })

  it('counts a deleted, previously published item as a change', () => {
    const plan = planPush({ items: [item('kept', 'a'), item('skipped', 'b')], last })
    expect(plan.removed).toEqual(['editedOn'])
    expect(hasChanges(plan)).toBe(true)
    expect(hasChanges(planPush({ items: [item('kept', 'a'), item('skipped', 'b'), item('editedOn', 'old'), item('edited', 'old')], last }))).toBe(false)
  })

  it('records the selection and hashes for the next push', () => {
    const plan = planPush({ items: [item('a', '1'), item('b', '2')], last: EMPTY_PUBLISH_STATE })
    expect(stateAfterPush({ rows: plan.rows, selectedIds: new Set(['a']), version: 3 })).toEqual({
      version: 3,
      items: { a: { selected: true, hash: '1' }, b: { selected: false, hash: '2' } },
    })
  })
})
