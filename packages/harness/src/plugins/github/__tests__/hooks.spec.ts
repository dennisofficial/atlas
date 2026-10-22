import { describe, expect, it } from 'bun:test'

import {
  AfterShellHook,
  AfterToolHook,
  EShellStatus,
  EToolEffect,
  toCallId,
  toThreadId,
  type EndedShell,
  type ThreadId,
  type ToolCall,
  type ToolOutcome,
} from '@dltech/atlas-core'

import { createIsolatedContainer, portToken, resolveHookChain } from '@dltech/atlas-harness'

import { createFamilyTracker, type FamilyTracker } from '../family-tracker'
import { RefreshPullRequestAfterShellHook, RefreshPullRequestAfterToolHook } from '../hooks'
import { checkoutKey, type RepositoryCheckout } from '../pure'
import type { PullRequestService } from '../pull-request-service'
import { aCheckout } from '../testing'

const NEVER_ABORTED = new AbortController().signal

const callOf = (args: { name?: string; input: unknown }): ToolCall => ({
  callId: toCallId('call-1'),
  name: args.name ?? 'bash',
  input: args.input,
  effect: EToolEffect.Destructive,
  threadId: toThreadId('thread-fixture'),
})

const SUCCEEDED: ToolOutcome = { ok: true, output: {}, modelText: 'done' }

const REFUSED: ToolOutcome = { ok: false, reason: 'the command failed' }

const THREAD = toThreadId('thread-fixture')
const OTHER_THREAD = toThreadId('thread-other')

const HERE = aCheckout({ directory: '/repo', branch: 'dennis/here' })
const ELSEWHERE = aCheckout({ directory: '/teammate', branch: 'dennis/elsewhere' })

type Counted = {
  service: PullRequestService
  expected: () => readonly string[]
  rechecked: () => readonly string[]
}

const countingService = (): Counted => {
  const expected: string[] = []
  const rechecked: string[] = []
  const service = {
    snapshot: () => {
      throw new Error('unused')
    },
    version: () => 0,
    subscribe: () => () => undefined,
    ingest: () => undefined,
    track: () => undefined,
    setVisible: () => undefined,
    tracked: () => [],
    watch: () => undefined,
    current: () => null,
    states: () => [],
    refresh: async () => undefined,
    dispose: () => undefined,
    expectChecks: ({ checkout }) => {
      expected.push(checkoutKey(checkout))
    },
    recheck: ({ checkout }) => {
      rechecked.push(checkoutKey(checkout))
    },
  } satisfies PullRequestService

  return { service, expected: () => expected, rechecked: () => rechecked }
}

const probing =
  (answers: Readonly<Record<string, RepositoryCheckout | null>>) =>
  async ({ directory }: { directory: string }): Promise<RepositoryCheckout | null> =>
    answers[directory] ?? null

const trackerStanding = (
  places: readonly { threadId: ThreadId; checkout: RepositoryCheckout }[],
): FamilyTracker => {
  const tracker = createFamilyTracker({ service: countingService().service })
  for (const place of places) tracker.place(place)
  return tracker
}

type Told = { expected: number; rechecked: number }

const ranAfter = async (args: {
  input: unknown
  name?: string
  result?: ToolOutcome
}): Promise<number> => (await toldAfter(args)).expected

const toldAfter = async (args: {
  input: unknown
  name?: string
  result?: ToolOutcome
}): Promise<Told> => {
  const { service, expected, rechecked } = countingService()
  const hook = new RefreshPullRequestAfterToolHook({
    pullRequests: service,
    probe: probing({ '/repo': HERE }),
  })

  await hook.run({
    call: callOf({ input: args.input, ...(args.name === undefined ? {} : { name: args.name }) }),
    result: args.result ?? SUCCEEDED,
    projectDirectory: '/repo',
    signal: NEVER_ABORTED,
  })

  return { expected: expected().length, rechecked: rechecked().length }
}

describe('the hook that hears a push', () => {
  it('expects checks after a command that starts work', async () => {
    expect(await ranAfter({ input: { command: 'git push -u origin HEAD' } })).toBe(1)
    expect(await ranAfter({ input: { command: 'bun test && git push' } })).toBe(1)
    expect(await ranAfter({ input: { command: 'gh pr create --fill' } })).toBe(1)
  })

  it('expects nothing after a command that starts none', async () => {
    expect(await ranAfter({ input: { command: 'bun test' } })).toBe(0)
    expect(await ranAfter({ input: { command: 'git status' } })).toBe(0)
  })

  /** A push that failed pushed nothing, so nothing downstream of it will start. */
  it('expects nothing when the command did not succeed', async () => {
    expect(await ranAfter({ input: { command: 'git push' }, result: REFUSED })).toBe(0)
  })

  it('ignores a tool that is not bash, however its input reads', async () => {
    expect(await ranAfter({ input: { command: 'git push' }, name: 'write_file' })).toBe(0)
  })

  it('ignores an input that carries no command at all', async () => {
    expect(await ranAfter({ input: {} })).toBe(0)
    expect(await ranAfter({ input: null })).toBe(0)
    expect(await ranAfter({ input: { command: 42 } })).toBe(0)
    expect(await ranAfter({ input: 'git push' })).toBe(0)
  })

  it('writes nothing to the log, because CI is not something the session did', async () => {
    const { service } = countingService()
    const hook = new RefreshPullRequestAfterToolHook({
      pullRequests: service,
      probe: probing({ '/repo': HERE }),
    })

    const outcome = await hook.run({
      call: callOf({ input: { command: 'git push' } }),
      result: SUCCEEDED,
      projectDirectory: '/repo',
      signal: NEVER_ABORTED,
    })

    expect(outcome).toEqual({})
  })
})

const endedShell = (args: {
  command: string
  status?: EShellStatus
  exitCode?: number
}): EndedShell => ({
  shellId: 'bash_1',
  command: args.command,
  status: args.status ?? EShellStatus.Exited,
  ...(args.exitCode === undefined ? {} : { exitCode: args.exitCode }),
})

const ranAfterShell = async (shell: EndedShell): Promise<number> =>
  (await toldAfterShell(shell)).expected

const toldAfterShell = async (shell: EndedShell): Promise<Told> => {
  const { service, expected, rechecked } = countingService()
  const hook = new RefreshPullRequestAfterShellHook({
    pullRequests: service,
    tracker: trackerStanding([{ threadId: THREAD, checkout: HERE }]),
  })

  await hook.run({ threadId: THREAD, shell })

  return { expected: expected().length, rechecked: rechecked().length }
}

describe('the hook that hears a backgrounded push', () => {
  it('expects checks once a backgrounded push has actually finished', async () => {
    expect(await ranAfterShell(endedShell({ command: 'git push', exitCode: 0 }))).toBe(1)
    expect(await ranAfterShell(endedShell({ command: 'bun test && git push', exitCode: 0 }))).toBe(
      1,
    )
  })

  it('expects nothing from a shell that started no work', async () => {
    expect(await ranAfterShell(endedShell({ command: 'bun run dev', exitCode: 0 }))).toBe(0)
  })

  it('expects nothing from a shell that ran to completion and failed', async () => {
    expect(await ranAfterShell(endedShell({ command: 'git push', exitCode: 1 }))).toBe(0)
  })

  /** A watch that pushed an hour ago and was killed at teardown still pushed. */
  it('expects checks from a killed shell, which may have pushed long before it died', async () => {
    expect(
      await ranAfterShell(
        endedShell({ command: 'git push && bun run dev', status: EShellStatus.Killed }),
      ),
    ).toBe(1)
  })

  it('writes nothing to the log', async () => {
    const { service } = countingService()
    const hook = new RefreshPullRequestAfterShellHook({
      pullRequests: service,
      tracker: trackerStanding([{ threadId: THREAD, checkout: HERE }]),
    })

    const outcome = await hook.run({
      threadId: THREAD,
      shell: endedShell({ command: 'git push', exitCode: 0 }),
    })

    expect(outcome).toEqual({})
  })
})

describe('a command that only settles the pull request', () => {
  it('asks once rather than opening a window', async () => {
    expect(await toldAfter({ input: { command: 'gh pr merge --squash' } })).toEqual({
      expected: 0,
      rechecked: 1,
    })
    expect(await toldAfter({ input: { command: 'gh pr close' } })).toEqual({
      expected: 0,
      rechecked: 1,
    })
  })

  it('opens a window when the chain also pushed', async () => {
    expect(await toldAfter({ input: { command: 'git push && gh pr merge' } })).toEqual({
      expected: 1,
      rechecked: 0,
    })
  })

  it('tells the service nothing about a command that changes neither', async () => {
    expect(await toldAfter({ input: { command: 'bun test' } })).toEqual({
      expected: 0,
      rechecked: 0,
    })
  })

  it('hears a merge that ran in a background shell too', async () => {
    expect(await toldAfterShell(endedShell({ command: 'gh pr merge', exitCode: 0 }))).toEqual({
      expected: 0,
      rechecked: 1,
    })
  })
})

describe('the wiring the composition root uses', () => {
  it('reaches both phases of the hook chain when registered by value', async () => {
    const { service, expected } = countingService()
    const container = createIsolatedContainer()
    container.register(portToken(AfterToolHook), {
      useValue: new RefreshPullRequestAfterToolHook({
        pullRequests: service,
        probe: probing({ '/repo': HERE }),
      }),
    })
    container.register(portToken(AfterShellHook), {
      useValue: new RefreshPullRequestAfterShellHook({
        pullRequests: service,
        tracker: trackerStanding([{ threadId: THREAD, checkout: HERE }]),
      }),
    })

    const chain = resolveHookChain({ container })

    const call = callOf({ input: { command: 'git push' } })
    for (const hook of chain.afterTool)
      await hook.run({ call, result: SUCCEEDED, projectDirectory: '/repo', signal: NEVER_ABORTED })
    await chain.afterShell({ threadId: THREAD, shell: endedShell({ command: 'git push', exitCode: 0 }) })

    expect(expected()).toHaveLength(2)
  })
})
