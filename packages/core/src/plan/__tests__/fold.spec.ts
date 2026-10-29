import { describe, expect, it } from 'bun:test'

import { foldPlan, planTaskLabel } from '../fold'
import { EPlanStatus, type PlanTask } from '../plan'

const task = (ordinal: number, status: EPlanStatus, activeForm?: string): PlanTask => ({
  ordinal,
  text: `task ${ordinal}`,
  status,
  activeForm,
})

describe('folding a plan', () => {
  const done = [1, 2, 3, 4, 5].map((n) => task(n, EPlanStatus.Completed))
  const tasks = [...done, task(6, EPlanStatus.InProgress), task(7, EPlanStatus.Pending)]

  it('keeps the last two completed and folds the older ones', () => {
    const fold = foldPlan({ tasks, expanded: false })

    expect(fold.hidden).toBe(3)
    expect(fold.shown.map((one) => one.ordinal)).toEqual([4, 5, 6, 7])
  })

  it('restores the hidden tasks in order when expanded', () => {
    const fold = foldPlan({ tasks, expanded: true })

    expect(fold.hidden).toBe(3)
    expect(fold.shown.map((one) => one.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('folds nothing when fewer than the minimum would hide', () => {
    const few = tasks.slice(2)

    expect(foldPlan({ tasks: few, expanded: false })).toEqual({ shown: few, hidden: 0 })
  })
})

describe('labelling a task', () => {
  it('uses the active form only while running', () => {
    expect(planTaskLabel(task(1, EPlanStatus.InProgress, 'Doing 1'))).toBe('Doing 1')
    expect(planTaskLabel(task(1, EPlanStatus.Pending, 'Doing 1'))).toBe('task 1')
    expect(planTaskLabel(task(1, EPlanStatus.InProgress))).toBe('task 1')
  })
})
