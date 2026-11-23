import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { EPlanStatus, type PlanTask } from '@dltech/atlas-core'
import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Root } from 'react-dom/client'

import { SessionTodoSection } from '../details/todo-section'

const task = (overrides: Partial<PlanTask>): PlanTask => ({
  ordinal: 1,
  text: 'Read the v2 pane brief',
  status: EPlanStatus.Completed,
  ...overrides,
})

const tasks: readonly PlanTask[] = [
  task({ ordinal: 1, text: 'Read the v2 pane brief' }),
  task({
    ordinal: 2,
    text: 'Build the details variants',
    status: EPlanStatus.InProgress,
    activeForm: 'Building the details variants',
  }),
  task({ ordinal: 3, text: 'Run typecheck and biome', status: EPlanStatus.Pending }),
]

let root: Root
let container: HTMLDivElement
beforeEach(async () => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  await unregisterDom()
})

const toggleOf = (): HTMLElement => container.querySelector('button') as HTMLElement

const longPlan = Array.from({ length: 8 }, (_, index) =>
  task({
    ordinal: index + 1,
    text: `task ${index + 1}`,
    status: index < 6 ? EPlanStatus.Completed : EPlanStatus.Pending,
  }),
)

describe('SessionTodoSection', () => {
  it('shows an empty line without a plan', () => {
    const html = renderToStaticMarkup(<SessionTodoSection tasks={[]} />)
    expect(html).toContain('aria-label="Todo"')
    expect(html).toContain('No plan yet')
  })

  it('always shows one row per task with its status glyph', () => {
    act(() => root.render(<SessionTodoSection tasks={tasks} />))

    expect(container.textContent).toContain('1 / 3 tasks')
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelectorAll('[data-pane-row]').length).toBe(3)
    expect(container.textContent).toContain('Building the details variants')
    expect(container.querySelector('[aria-label="Done"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="In progress"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Pending"]')).not.toBeNull()
    expect(container.textContent).toContain('Run typecheck and biome')
  })

  it('folds the earlier done tasks but keeps the last two and every open task', () => {
    act(() => root.render(<SessionTodoSection tasks={longPlan} />))

    expect(toggleOf().textContent).toBe('4 earlier done')
    expect(toggleOf().getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelectorAll('[data-pane-row]').length).toBe(4)
    expect(container.textContent).not.toContain('task 4')
    expect(container.textContent).toContain('task 5')
    expect(container.textContent).toContain('task 8')
  })

  it('shows every task when the fold opens and folds again on a second click', async () => {
    act(() => root.render(<SessionTodoSection tasks={longPlan} />))
    await act(async () => toggleOf().click())

    expect(toggleOf().textContent).toBe('Show fewer')
    expect(container.querySelectorAll('[data-pane-row]').length).toBe(8)
    expect(container.textContent).toContain('task 1')

    await act(async () => toggleOf().click())
    expect(container.querySelectorAll('[data-pane-row]').length).toBe(4)
  })
})
