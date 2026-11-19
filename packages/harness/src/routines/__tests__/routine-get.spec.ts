import { describe, expect, it } from 'bun:test'

import type { ApiClient } from '@dltech/atlas-api-router'
import { EToolEffect, toThreadId, type ToolOutcome } from '@dltech/atlas-core'

import { RoutineGetTool } from '../../tools/builtin/routine-get'
import { NOT_IN_A_PROJECT, NOT_SIGNED_IN, type RoutineToolDeps } from '../tool-deps'

const calls: string[] = []

const routineRow = (overrides: Record<string, unknown> = {}) => ({
  routineId: 'r1',
  projectId: 'p1',
  name: 'Nightly triage',
  prompt: 'Triage new issues.',
  cron: '0 3 * * *',
  timezone: 'UTC',
  enabled: true,
  model: null,
  effort: null,
  fast: null,
  nextRunAt: '2026-11-12T03:00:00.000Z',
  lastRunAt: null,
  lastSessionId: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...overrides,
})

const clientOf = (read: (input?: unknown) => Promise<unknown>): ApiClient =>
  ({ routines: { get: { query: read } } }) as unknown as ApiClient

const recording = (result: unknown) => async (input?: unknown) => {
  calls.push(`get ${JSON.stringify(input ?? null)}`)
  return result
}

const depsOf = (client: ApiClient, projectId: string | null = 'p1'): RoutineToolDeps => ({
  access: async () => ({ api: client, projectId }),
})

const invoke = (args: { tool: RoutineGetTool; input: unknown }): Promise<ToolOutcome> =>
  args.tool.invoke({
    input: args.input,
    signal: new AbortController().signal,
    idempotencyKey: 'k',
    projectDirectory: '/repo',
    threadId: toThreadId('t'),
  } as Parameters<typeof args.tool.invoke>[0])

const textOf = (outcome: ToolOutcome): string => (outcome.ok ? outcome.modelText : outcome.reason)

describe('routine_get', () => {
  it('reads, and says it reads the prompt', () => {
    const tool = new RoutineGetTool(depsOf(clientOf(recording(routineRow()))))
    expect(tool.effect).toBe(EToolEffect.Read)
    expect(tool.description).toContain('full prompt')
    expect(tool.description).toContain('minute hour day-of-month month weekday')
  })

  it('returns the routine with its full prompt, scoped to the session project', async () => {
    calls.length = 0
    const outcome = await invoke({
      tool: new RoutineGetTool(depsOf(clientOf(recording(routineRow())))),
      input: { routineId: 'r1' },
    })
    expect(textOf(outcome)).toContain('Prompt:\nTriage new issues.')
    expect(textOf(outcome)).toContain('next run 2026-11-12T03:00:00.000Z')
    expect(outcome.ok && outcome.output).toEqual(routineRow())
    expect(calls).toEqual(['get {"routineId":"r1","projectId":"p1"}'])
  })

  it('fails clearly for an id the project does not have', async () => {
    const tool = new RoutineGetTool(
      depsOf(
        clientOf(async () => {
          throw new Error('routine not found: ghost')
        }),
      ),
    )
    const outcome = await invoke({ tool, input: { routineId: 'ghost' } })
    expect(outcome.ok).toBe(false)
    expect(textOf(outcome)).toContain('routine not found: ghost')
  })

  it('refuses without a cloud session, and without a project', async () => {
    const signedOut = new RoutineGetTool({ access: async () => null })
    expect(await invoke({ tool: signedOut, input: { routineId: 'r1' } })).toEqual({
      ok: false,
      reason: NOT_SIGNED_IN,
    })
    const noProject = new RoutineGetTool(depsOf(clientOf(recording(routineRow())), null))
    expect(await invoke({ tool: noProject, input: { routineId: 'r1' } })).toEqual({
      ok: false,
      reason: NOT_IN_A_PROJECT,
    })
  })
})
