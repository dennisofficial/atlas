import { describe, expect, it } from 'bun:test'

import type { ApiClient } from '@dltech/atlas-api-router'
import { EToolEffect, toThreadId, type ToolOutcome } from '@dltech/atlas-core'

import type { CloudSession, CloudSessionStore } from '../../cloud/cloud-session'
import { routineAccessOf, type RoutineAccessSource } from '../routine-access'
import { NOT_IN_A_PROJECT, NOT_SIGNED_IN, type RoutineToolDeps } from '../tool-deps'
import { RoutineCreateTool } from '../../tools/builtin/routine-create'
import { RoutineDeleteTool } from '../../tools/builtin/routine-delete'
import { RoutineListTool } from '../../tools/builtin/routine-list'
import { RoutineRunTool } from '../../tools/builtin/routine-run'
import { RoutineUpdateTool } from '../../tools/builtin/routine-update'
import type { ThreadStorePort } from '../../store/thread-store'

const calls: string[] = []

const record = (name: string, result: unknown) => async (input?: unknown) => {
  calls.push(`${name} ${JSON.stringify(input ?? null)}`)
  return result
}

const refuse = (name: string, message: string) => async () => {
  calls.push(`${name} failed`)
  throw new Error(message)
}

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

const clientOf = (overrides: Record<string, unknown> = {}): ApiClient =>
  ({
    routines: {
      list: {
        query: record('list', {
          routines: [routineRow(), routineRow({ routineId: 'r2', projectId: 'p2' })],
        }),
      },
      create: { mutate: record('create', routineRow({ routineId: 'r3', enabled: false })) },
      update: { mutate: record('update', routineRow({ enabled: false })) },
      remove: { mutate: record('remove', { removed: true }) },
      runNow: { mutate: record('runNow', { sessionId: 's1' }) },
      ...overrides,
    },
  }) as unknown as ApiClient

const depsOf = (client: ApiClient, projectId: string | null = 'p1'): RoutineToolDeps => ({
  access: async () => ({ api: client, projectId }),
})

const signedOut: RoutineAccessSource = async () => null

type Tool =
  | RoutineListTool
  | RoutineCreateTool
  | RoutineUpdateTool
  | RoutineDeleteTool
  | RoutineRunTool

const invoke = (args: { tool: Tool; input: unknown }): Promise<ToolOutcome> =>
  args.tool.invoke({
    input: args.input,
    signal: new AbortController().signal,
    idempotencyKey: 'k',
    projectDirectory: '/repo',
    threadId: toThreadId('t'),
  } as Parameters<typeof args.tool.invoke>[0])

const textOf = (outcome: ToolOutcome): string => (outcome.ok ? outcome.modelText : outcome.reason)

describe('routineAccessOf', () => {
  const threads = {
    find: async () => ({ projectId: 'p1' }),
  } as unknown as ThreadStorePort
  const session: CloudSession = { url: 'https://api.test', token: 'tok', email: null }

  it('answers nothing without a cloud session', async () => {
    const access = routineAccessOf({
      serveSession: null,
      sessionStore: null,
      threads,
      clientVersion: 'test',
    })
    expect(await access({ threadId: toThreadId('t') })).toBeNull()
  })

  it('carries the stored session and the thread project', async () => {
    const sessionStore = { read: () => session } as unknown as CloudSessionStore
    const access = routineAccessOf({
      serveSession: null,
      sessionStore,
      threads,
      clientVersion: 'test',
    })
    const reached = await access({ threadId: toThreadId('t') })
    expect(reached?.projectId).toBe('p1')
    expect(typeof reached?.api.routines.list.query).toBe('function')
  })
})

describe('the routine tools', () => {
  it('declares list a read and the rest writes', () => {
    const deps = depsOf(clientOf())
    expect(new RoutineListTool(deps).effect).toBe(EToolEffect.Read)
    expect(new RoutineCreateTool(deps).effect).toBe(EToolEffect.Write)
    expect(new RoutineUpdateTool(deps).effect).toBe(EToolEffect.Write)
    expect(new RoutineDeleteTool(deps).effect).toBe(EToolEffect.Write)
    expect(new RoutineRunTool(deps).effect).toBe(EToolEffect.Write)
  })

  it('tells the model the cron, timezone and 5-minute floor up front', () => {
    const deps = depsOf(clientOf())
    for (const tool of [
      new RoutineListTool(deps),
      new RoutineCreateTool(deps),
      new RoutineUpdateTool(deps),
      new RoutineDeleteTool(deps),
      new RoutineRunTool(deps),
    ]) {
      expect(tool.description).toContain('minute hour day-of-month month weekday')
      expect(tool.description).toContain('more often than every 5 minutes')
      expect(tool.description).toContain('IANA timezone')
      expect(tool.description).toContain('Routines page in the Atlas web app')
      expect(tool.description).toContain('a fresh session each run')
    }
  })

  it('refuses every tool without a session', async () => {
    const deps: RoutineToolDeps = { access: signedOut }
    const outcomes = await Promise.all([
      invoke({ tool: new RoutineListTool(deps), input: {} }),
      invoke({
        tool: new RoutineCreateTool(deps),
        input: { name: 'n', prompt: 'p', cron: '0 3 * * *', timezone: 'UTC' },
      }),
      invoke({ tool: new RoutineUpdateTool(deps), input: { routineId: 'r1', enabled: false } }),
      invoke({ tool: new RoutineDeleteTool(deps), input: { routineId: 'r1' } }),
      invoke({ tool: new RoutineRunTool(deps), input: { routineId: 'r1' } }),
    ])
    for (const outcome of outcomes) expect(outcome).toEqual({ ok: false, reason: NOT_SIGNED_IN })
  })

  it('refuses without a project, naming why', async () => {
    const deps = depsOf(clientOf(), null)
    expect(await invoke({ tool: new RoutineListTool(deps), input: {} })).toEqual({
      ok: false,
      reason: NOT_IN_A_PROJECT,
    })
  })

  it('lists only the session project’s routines', async () => {
    calls.length = 0
    const outcome = await invoke({ tool: new RoutineListTool(depsOf(clientOf())), input: {} })
    expect(outcome.ok && outcome.modelText).toContain(
      'r1  Nightly triage  0 3 * * * in UTC  enabled  next 2026-11-12T03:00:00.000Z  last session none',
    )
    expect(textOf(outcome)).not.toContain('r2')
    expect(outcome.ok && outcome.output).toEqual({
      routines: [
        {
          routineId: 'r1',
          name: 'Nightly triage',
          cron: '0 3 * * *',
          timezone: 'UTC',
          enabled: true,
          nextRunAt: '2026-11-12T03:00:00.000Z',
          lastSessionId: null,
        },
      ],
    })
    expect(calls).toEqual(['list {}'])
  })

  it('says so when the project has no routines', async () => {
    const client = clientOf({ list: { query: async () => ({ routines: [] }) } })
    expect(textOf(await invoke({ tool: new RoutineListTool(depsOf(client)), input: {} }))).toBe(
      'This project has no routines.',
    )
  })

  it('creates in the session project and names the next run', async () => {
    calls.length = 0
    const outcome = await invoke({
      tool: new RoutineCreateTool(depsOf(clientOf())),
      input: {
        name: 'Nightly triage',
        prompt: 'Triage new issues.',
        cron: '0 3 * * *',
        timezone: 'Europe/London',
        enabled: false,
      },
    })
    expect(textOf(outcome)).toContain('Created routine Nightly triage (r3)')
    expect(textOf(outcome)).toContain('next run 2026-11-12T03:00:00.000Z, paused')
    expect(calls).toEqual([
      'create {"projectId":"p1","name":"Nightly triage","prompt":"Triage new issues.","cron":"0 3 * * *","timezone":"Europe/London","enabled":false}',
    ])
  })

  it('requires a timezone rather than inventing one', async () => {
    const outcome = await invoke({
      tool: new RoutineCreateTool(depsOf(clientOf())),
      input: { name: 'n', prompt: 'p', cron: '0 3 * * *' },
    })
    expect(outcome.ok).toBe(false)
    expect(textOf(outcome)).toContain('timezone')
  })

  it('updates only the fields that were passed', async () => {
    calls.length = 0
    const outcome = await invoke({
      tool: new RoutineUpdateTool(depsOf(clientOf())),
      input: { routineId: 'r1', enabled: false },
    })
    expect(textOf(outcome)).toContain('Updated routine Nightly triage (r1)')
    expect(textOf(outcome)).toContain('paused')
    expect(calls).toEqual(['update {"routineId":"r1","enabled":false}'])
  })

  it('rejects an update that changes nothing', async () => {
    calls.length = 0
    const outcome = await invoke({
      tool: new RoutineUpdateTool(depsOf(clientOf())),
      input: { routineId: 'r1' },
    })
    expect(outcome.ok).toBe(false)
    expect(textOf(outcome)).toContain('at least one of')
    expect(calls).toEqual([])
  })

  it('deletes a routine and fails when the API removed nothing', async () => {
    calls.length = 0
    const deleted = await invoke({
      tool: new RoutineDeleteTool(depsOf(clientOf())),
      input: { routineId: 'r1' },
    })
    expect(textOf(deleted)).toBe('Deleted routine r1.')
    const missing = await invoke({
      tool: new RoutineDeleteTool(
        depsOf(clientOf({ remove: { mutate: async () => ({ removed: false }) } })),
      ),
      input: { routineId: 'ghost' },
    })
    expect(missing.ok).toBe(false)
    expect(textOf(missing)).toContain('no routine "ghost"')
    expect(calls).toEqual(['remove {"routineId":"r1"}'])
  })

  it('starts a run now and returns the new session id', async () => {
    calls.length = 0
    const outcome = await invoke({
      tool: new RoutineRunTool(depsOf(clientOf())),
      input: { routineId: 'r1' },
    })
    expect(textOf(outcome)).toBe('Started routine r1 now in session s1.')
    expect(outcome.ok && outcome.output).toEqual({ sessionId: 's1' })
    expect(calls).toEqual(['runNow {"routineId":"r1"}'])
  })

  it('turns an API failure into a reason instead of throwing', async () => {
    const client = clientOf({
      list: { query: refuse('list', 'routine service down') },
      create: { mutate: refuse('create', 'routine service down') },
      update: { mutate: refuse('update', 'routine service down') },
      remove: { mutate: refuse('remove', 'routine service down') },
      runNow: { mutate: refuse('runNow', 'routine service down') },
    })
    const outcomes = await Promise.all([
      invoke({ tool: new RoutineListTool(depsOf(client)), input: {} }),
      invoke({
        tool: new RoutineCreateTool(depsOf(client)),
        input: { name: 'n', prompt: 'p', cron: '0 3 * * *', timezone: 'UTC' },
      }),
      invoke({
        tool: new RoutineUpdateTool(depsOf(client)),
        input: { routineId: 'r1', name: 'b' },
      }),
      invoke({ tool: new RoutineDeleteTool(depsOf(client)), input: { routineId: 'r1' } }),
      invoke({ tool: new RoutineRunTool(depsOf(client)), input: { routineId: 'r1' } }),
    ])
    for (const outcome of outcomes) {
      expect(outcome.ok).toBe(false)
      expect(textOf(outcome)).toContain('routine service down')
    }
  })
})
