import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { EStepStatus, type PlanStep } from '../plan'
import { PlanSummary, dockStatus, dockSummary } from '../plan-summary'

const steps: PlanStep[] = [
  { id: '1', title: 'Read', status: EStepStatus.Done },
  { id: '2', title: 'Writing', status: EStepStatus.Running },
]

describe('PlanSummary', () => {
  it('renders nothing without a plan', () => {
    expect(renderToStaticMarkup(<PlanSummary steps={[]} onOpen={() => undefined} />)).toBe('')
  })

  it('shows the count, the running step and the progress', () => {
    const html = renderToStaticMarkup(<PlanSummary steps={steps} onOpen={() => undefined} />)
    expect(html).toContain('1 of 2 · Writing')
    expect(html).toContain('aria-label="Plan progress"')
  })
})

const step = (id: string, title: string, status: EStepStatus): PlanStep => ({ id, title, status })

describe('dockSummary', () => {
  it('names the running step', () => {
    expect(dockSummary(steps)).toEqual({ done: 1, total: 2, label: '1 of 2 · Writing' })
  })

  it('names the next pending step when nothing is running', () => {
    const pending = [step('1', 'A', EStepStatus.Done), step('2', 'Build it', EStepStatus.Pending)]
    expect(dockSummary(pending).label).toBe('1 of 2 · Next: Build it')
  })

  it('reads Done when every step is done', () => {
    const done = [step('1', 'A', EStepStatus.Done), step('2', 'B', EStepStatus.Done)]
    expect(dockSummary(done).label).toBe('2 of 2 · Done')
    expect(dockStatus(done)).toBe(EStepStatus.Done)
  })

  it('names a failed step ahead of a running one', () => {
    const failed = [step('1', 'Lint', EStepStatus.Error), step('2', 'B', EStepStatus.Running)]
    expect(dockSummary(failed).label).toBe('0 of 2 · Failed: Lint')
    expect(dockStatus(failed)).toBe(EStepStatus.Error)
  })
})
