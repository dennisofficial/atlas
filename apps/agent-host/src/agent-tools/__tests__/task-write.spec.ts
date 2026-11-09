import { describe, expect, it } from 'bun:test'

import { PLAN_TASK_LIMIT, toThreadId, type PlanTask } from '@dltech/atlas-core'

import { TaskWriteTool } from '../task-write'

const invoke = (
  tool: TaskWriteTool,
  input: unknown,
): Promise<{ ok: boolean; [key: string]: unknown }> =>
  tool.invoke({
    input,
    signal: new AbortController().signal,
    idempotencyKey: 'key-1',
    projectDirectory: '/work/repo',
    activeWorktree: undefined,
    threadId: toThreadId('thr_1'),
  }) as Promise<{ ok: boolean; [key: string]: unknown }>

const tool = new TaskWriteTool()

describe('TaskWriteTool', () => {
  it('is the tool the host prompt names', () => {
    expect(tool.name).toBe('task_write')
  })

  it('renders the whole list with the position as the number', async () => {
    const outcome = await invoke(tool, {
      tasks: [
        { text: 'Read the spec', status: 'completed' },
        { text: 'Build the tool', status: 'in_progress', activeForm: 'Building the tool' },
        { text: 'Open the PR' },
      ],
    })

    expect(outcome.ok).toBe(true)
    const tasks = (outcome.output as { tasks: readonly PlanTask[] }).tasks
    expect(tasks.map((task) => task.ordinal)).toEqual([1, 2, 3])
    expect(tasks[2]?.status).toBe('pending')
    expect(String(outcome.modelText)).toContain(
      '#2 [in_progress] Build the tool (active: Building the tool)',
    )
    expect(String(outcome.modelText)).toContain('#3 [pending] Open the PR')
  })

  it('accepts an empty plan, which clears the checklist', async () => {
    const outcome = await invoke(tool, { tasks: [] })

    expect(outcome.ok).toBe(true)
    expect(String(outcome.modelText)).toBe('No plan yet.')
  })

  it('refuses more tasks than the panel holds', async () => {
    const tasks = Array.from({ length: PLAN_TASK_LIMIT + 1 }, (_, index) => ({
      text: `task ${index}`,
    }))

    const outcome = await invoke(tool, { tasks })

    expect(outcome.ok).toBe(false)
  })

  it('refuses a task that is a paragraph', async () => {
    const outcome = await invoke(tool, { tasks: [{ text: 'x'.repeat(121) }] })

    expect(outcome.ok).toBe(false)
  })
})
