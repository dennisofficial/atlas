import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { EStepStatus, type PlanStep } from '../plan'
import { TaskDock, dockSummary } from '../task-dock'

const step = (id: string, title: string, status: EStepStatus): PlanStep => ({ id, title, status })

const RUNNING: PlanStep[] = [
  step('1', 'Read the tokens', EStepStatus.Done),
  step('2', 'Running typecheck', EStepStatus.Running),
  step('3', 'Run the specs', EStepStatus.Pending),
]

describe('dockSummary', () => {
  it('names the running step', () => {
    expect(dockSummary(RUNNING)).toEqual({
      done: 1,
      total: 3,
      label: '1 of 3 · Running typecheck',
    })
  })

  it('names the next pending step when nothing is running', () => {
    const steps = [step('1', 'A', EStepStatus.Done), step('2', 'Build it', EStepStatus.Pending)]

    expect(dockSummary(steps).label).toBe('1 of 2 · Next: Build it')
  })

  it('reads Done when every step is done', () => {
    const steps = [step('1', 'A', EStepStatus.Done), step('2', 'B', EStepStatus.Done)]

    expect(dockSummary(steps).label).toBe('2 of 2 · Done')
  })

  it('names a failed step ahead of a running one', () => {
    const steps = [
      step('1', 'A', EStepStatus.Done),
      step('2', 'Lint', EStepStatus.Error),
      step('3', 'B', EStepStatus.Running),
    ]

    expect(dockSummary(steps).label).toBe('1 of 3 · Failed: Lint')
  })
})

describe('TaskDock', () => {
  it('renders nothing without steps or queued messages', () => {
    expect(renderToStaticMarkup(<TaskDock steps={[]} />)).toBe('')
    expect(renderToStaticMarkup(<TaskDock steps={[]} queued={[]} />)).toBe('')
  })

  it('renders a collapsed strip with the summary, queue chip and progress', () => {
    const html = renderToStaticMarkup(
      <TaskDock steps={RUNNING} queued={[{ id: 'q1', text: 'Also fix the README' }]} />,
    )

    expect(html).toContain('1 of 3 · Running typecheck')
    expect(html).toContain('1 queued')
    expect(html).toContain('data-slot="progress"')
    expect(html).toContain('aria-valuenow="33.33333333333333"')
    expect(html).not.toContain('Also fix the README')
    expect(html).not.toContain('Read the tokens')
  })

  it('lists the plan and queued messages when open', () => {
    const html = renderToStaticMarkup(
      <TaskDock steps={RUNNING} queued={[{ id: 'q1', text: 'Also fix the README' }]} defaultOpen />,
    )

    expect(html).toContain('Read the tokens')
    expect(html).toContain('Run the specs')
    expect(html).toContain('Queued')
    expect(html).toContain('Also fix the README')
    expect(html).toContain('Remove queued message')
  })

  it('hides the remove button on a message that cannot be removed', () => {
    const html = renderToStaticMarkup(
      <TaskDock
        steps={[]}
        queued={[{ id: 'q1', text: 'Started already', removable: false }]}
        defaultOpen
      />,
    )

    expect(html).toContain('Started already')
    expect(html).not.toContain('Remove queued message')
  })

  it('renders a queue-only dock', () => {
    const html = renderToStaticMarkup(
      <TaskDock steps={[]} queued={[{ id: 'q1', text: 'Later' }]} />,
    )

    expect(html).toContain('Queued messages')
    expect(html).not.toContain('data-slot="progress"')
  })
})
