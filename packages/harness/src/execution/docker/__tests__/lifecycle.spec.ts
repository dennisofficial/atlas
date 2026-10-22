import { describe, expect, it } from 'bun:test'

import {
  EBeforeToolDecision,
  EToolEffect,
  EWorktreeExit,
  toCallId,
  toThreadId,
  type ToolCall,
} from '@dltech/atlas-core'

import { sessionLabel, worktreeLabel } from '../sandbox'
import {
  BashActivityHook,
  ReclaimWorktreeSandboxHook,
  removeSandbox,
  removeSandboxesAtWorktree,
  startIdleStop,
  stopSandbox,
  sweepSandboxes,
  type LifecycleEngine,
} from '../lifecycle'

type Fixture = {
  id: string
  state: string
  worktree?: string | undefined
  session?: string | undefined
}

type NetworkFixture = {
  id: string
  worktree?: string | undefined
  session?: string | undefined
}

type Recorded = {
  stopped: string[]
  removed: string[]
  removedNetworks: string[]
}

const fakeEngine = (args: {
  containers?: Fixture[]
  networks?: NetworkFixture[]
}): { engine: LifecycleEngine; recorded: Recorded } => {
  const recorded: Recorded = { stopped: [], removed: [], removedNetworks: [] }

  const engine: LifecycleEngine = {
    listContainers: async (query) => {
      const wanted = query?.labels ?? {}
      return (args.containers ?? [])
        .map((one) => ({
          id: one.id,
          name: one.id,
          state: one.state,
          labels: {
            ...(one.worktree === undefined ? {} : { [worktreeLabel('atlas-test')]: one.worktree }),
            ...(one.session === undefined ? {} : { [sessionLabel('atlas-test')]: one.session }),
          },
        }))
        .filter((one) =>
          Object.entries(wanted).every(([key, value]) =>
            value === undefined ? key in one.labels : one.labels[key] === value,
          ),
        )
    },
    listNetworks: async (query) => {
      const wanted = query?.labels ?? {}
      return (args.networks ?? [])
        .map((one) => ({
          id: one.id,
          name: one.id,
          labels: {
            ...(one.worktree === undefined ? {} : { [worktreeLabel('atlas-test')]: one.worktree }),
            ...(one.session === undefined ? {} : { [sessionLabel('atlas-test')]: one.session }),
          },
        }))
        .filter((one) =>
          Object.entries(wanted).every(([key, value]) =>
            value === undefined ? key in one.labels : one.labels[key] === value,
          ),
        )
    },
    stopContainer: async ({ id }) => {
      recorded.stopped.push(id)
    },
    removeContainer: async ({ id }) => {
      recorded.removed.push(id)
    },
    removeNetwork: async ({ id }) => {
      recorded.removedNetworks.push(id)
    },
  }

  return { engine, recorded }
}

describe('stopSandbox', () => {
  it('stops the running container labelled for the session', async () => {
    const { engine, recorded } = fakeEngine({
      containers: [{ id: 'one', state: 'running', worktree: '/repo/wt', session: 'thread-a' }],
    })

    expect(await stopSandbox({ engine, prefix: 'atlas-test', session: 'thread-a' })).toBe(true)
    expect(recorded.stopped).toEqual(['one'])
  })

  it('leaves an already-stopped container alone', async () => {
    const { engine, recorded } = fakeEngine({
      containers: [{ id: 'one', state: 'exited', worktree: '/repo/wt', session: 'thread-a' }],
    })

    expect(await stopSandbox({ engine, prefix: 'atlas-test', session: 'thread-a' })).toBe(false)
    expect(recorded.stopped).toEqual([])
  })

  it('does nothing when no container carries the session', async () => {
    const { engine, recorded } = fakeEngine({ containers: [] })

    expect(await stopSandbox({ engine, prefix: 'atlas-test', session: 'thread-a' })).toBe(false)
    expect(recorded.stopped).toEqual([])
  })

  it('never stops another session’s container over the same worktree', async () => {
    const { engine, recorded } = fakeEngine({
      containers: [{ id: 'theirs', state: 'running', worktree: '/repo/wt', session: 'thread-b' }],
    })

    expect(await stopSandbox({ engine, prefix: 'atlas-test', session: 'thread-a' })).toBe(false)
    expect(recorded.stopped).toEqual([])
  })

  it('stops the expose proxy alongside the sandbox it serves', async () => {
    const { engine, recorded } = fakeEngine({
      containers: [
        { id: 'sandbox', state: 'running', worktree: '/repo/wt', session: 'thread-a' },
        { id: 'proxy', state: 'running', worktree: '/repo/wt', session: 'thread-a' },
      ],
    })

    expect(await stopSandbox({ engine, prefix: 'atlas-test', session: 'thread-a' })).toBe(true)
    expect(recorded.stopped).toEqual(['sandbox', 'proxy'])
  })
})

describe('removeSandbox', () => {
  it('removes the container labelled for the session, running or not', async () => {
    const { engine, recorded } = fakeEngine({
      containers: [{ id: 'one', state: 'running', worktree: '/repo/wt', session: 'thread-a' }],
    })

    expect(await removeSandbox({ engine, prefix: 'atlas-test', session: 'thread-a' })).toBe(true)
    expect(recorded.removed).toEqual(['one'])
  })

  it('removes the session’s network alongside its containers', async () => {
    const { engine, recorded } = fakeEngine({
      containers: [{ id: 'one', state: 'running', worktree: '/repo/wt', session: 'thread-a' }],
      networks: [
        { id: 'net-a', worktree: '/repo/wt', session: 'thread-a' },
        { id: 'net-b', worktree: '/repo/wt', session: 'thread-b' },
      ],
    })

    expect(await removeSandbox({ engine, prefix: 'atlas-test', session: 'thread-a' })).toBe(true)
    expect(recorded.removed).toEqual(['one'])
    expect(recorded.removedNetworks).toEqual(['net-a'])
  })

  it('removes an orphaned session network even when its containers are already gone', async () => {
    const { engine, recorded } = fakeEngine({
      containers: [],
      networks: [{ id: 'net-a', worktree: '/repo/wt', session: 'thread-a' }],
    })

    expect(await removeSandbox({ engine, prefix: 'atlas-test', session: 'thread-a' })).toBe(false)
    expect(recorded.removedNetworks).toEqual(['net-a'])
  })

  it('does nothing when no container carries the session', async () => {
    const { engine, recorded } = fakeEngine({ containers: [] })

    expect(await removeSandbox({ engine, prefix: 'atlas-test', session: 'thread-a' })).toBe(false)
    expect(recorded.removed).toEqual([])
  })
})

describe('sweepSandboxes', () => {
  it('removes containers whose worktree is gone and keeps the rest', async () => {
    const { engine, recorded } = fakeEngine({
      containers: [
        { id: 'live', state: 'running', worktree: '/repo/.atlas/worktrees/live' },
        { id: 'orphan', state: 'exited', worktree: '/repo/.atlas/worktrees/merged' },
        { id: 'unlabelled', state: 'running' },
      ],
    })

    const removed = await sweepSandboxes({
      engine,
      prefix: 'atlas-test',
      worktrees: ['/repo', '/repo/.atlas/worktrees/live'],
      exists: () => false,
    })

    expect(recorded.removed).toEqual(['orphan'])
    expect(removed).toEqual(['/repo/.atlas/worktrees/merged'])
  })

  it('removes networks whose worktree is gone and keeps the rest', async () => {
    const { engine, recorded } = fakeEngine({
      containers: [],
      networks: [
        { id: 'net-live', worktree: '/repo/.atlas/worktrees/live' },
        { id: 'net-orphan', worktree: '/repo/.atlas/worktrees/merged' },
      ],
    })

    await sweepSandboxes({
      engine,
      prefix: 'atlas-test',
      worktrees: ['/repo', '/repo/.atlas/worktrees/live'],
      exists: () => false,
    })

    expect(recorded.removedNetworks).toEqual(['net-orphan'])
  })

  it('keeps a container whose worktree another repository still holds on disk', async () => {
    const { engine, recorded } = fakeEngine({
      containers: [{ id: 'foreign', state: 'running', worktree: '/other-repo/checkout' }],
    })

    const removed = await sweepSandboxes({
      engine,
      prefix: 'atlas-test',
      worktrees: ['/repo'],
      exists: () => true,
    })

    expect(recorded.removed).toEqual([])
    expect(removed).toEqual([])
  })
})

describe('the idle stopwatch', () => {
  const until = async (holds: () => boolean, attempts = 200): Promise<boolean> => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (holds()) return true
      await Bun.sleep(5)
    }
    return holds()
  }

  it('does not fire while a background shell is running, and fires once it ends', async () => {
    const { engine, recorded } = fakeEngine({
      containers: [{ id: 'one', state: 'running', worktree: '/repo/wt', session: 'thread-a' }],
    })
    let runningShells = 1
    let now = 1_000_000

    const idle = startIdleStop({
      engine,
      prefix: 'atlas-test',
      session: () => 'thread-a',
      runningShells: () => runningShells,
      idleMinutes: () => 1,
      now: () => now,
      tickMs: 5,
    })

    try {
      now += 5 * 60_000
      expect(await until(() => recorded.stopped.length > 0, 40)).toBe(false)

      runningShells = 0
      expect(await until(() => recorded.stopped.length > 0)).toBe(true)
      expect(recorded.stopped).toEqual(['one'])
    } finally {
      idle.halt()
    }
  })

  it('does not fire while a dockerized service is running, and fires once it ends', async () => {
    const { engine, recorded } = fakeEngine({
      containers: [{ id: 'one', state: 'running', worktree: '/repo/wt', session: 'thread-a' }],
    })
    let runningServices = 1
    let now = 1_000_000

    const idle = startIdleStop({
      engine,
      prefix: 'atlas-test',
      session: () => 'thread-a',
      runningShells: () => 0,
      runningServices: () => runningServices,
      idleMinutes: () => 1,
      now: () => now,
      tickMs: 5,
    })

    try {
      now += 5 * 60_000
      expect(await until(() => recorded.stopped.length > 0, 40)).toBe(false)

      runningServices = 0
      expect(await until(() => recorded.stopped.length > 0)).toBe(true)
      expect(recorded.stopped).toEqual(['one'])
    } finally {
      idle.halt()
    }
  })

  it('never fires before the session has created its container', async () => {
    const { engine, recorded } = fakeEngine({
      containers: [{ id: 'theirs', state: 'running', worktree: '/repo/wt', session: 'thread-b' }],
    })
    let now = 1_000_000

    const idle = startIdleStop({
      engine,
      prefix: 'atlas-test',
      session: () => undefined,
      runningShells: () => 0,
      idleMinutes: () => 1,
      now: () => now,
      tickMs: 5,
    })

    try {
      now += 5 * 60_000
      expect(await until(() => recorded.stopped.length > 0, 40)).toBe(false)
      expect(recorded.stopped).toEqual([])
    } finally {
      idle.halt()
    }
  })

  it('starts the window over when a bash call lands', async () => {
    const { engine, recorded } = fakeEngine({
      containers: [{ id: 'one', state: 'running', worktree: '/repo/wt', session: 'thread-a' }],
    })
    let now = 1_000_000

    const idle = startIdleStop({
      engine,
      prefix: 'atlas-test',
      session: () => 'thread-a',
      runningShells: () => 0,
      idleMinutes: () => 1,
      now: () => now,
      tickMs: 5,
    })

    try {
      now += 50_000
      idle.noteBash()
      await Bun.sleep(30)
      expect(recorded.stopped).toEqual([])

      now += 60_000
      expect(await until(() => recorded.stopped.length > 0)).toBe(true)
    } finally {
      idle.halt()
    }
  })

  it('reports when it stops the sandbox, and stays quiet while nothing is due', async () => {
    let state = 'running'
    const { engine, recorded } = fakeEngine({
      containers: [{ id: 'one', state: 'running', worktree: '/repo/wt', session: 'thread-a' }],
    })
    const stopping: LifecycleEngine = {
      ...engine,
      listContainers: async () => [
        {
          id: 'one',
          name: 'one',
          state,
          labels: {
            [worktreeLabel('atlas-test')]: '/repo/wt',
            [sessionLabel('atlas-test')]: 'thread-a',
          },
        },
      ],
      stopContainer: async ({ id }) => {
        recorded.stopped.push(id)
        state = 'exited'
      },
    }
    let now = 1_000_000
    let announced = 0

    const idle = startIdleStop({
      engine: stopping,
      prefix: 'atlas-test',
      session: () => 'thread-a',
      runningShells: () => 0,
      idleMinutes: () => 1,
      now: () => now,
      tickMs: 5,
      onStopped: () => {
        announced += 1
      },
    })

    try {
      expect(await until(() => announced > 0, 40)).toBe(false)

      now += 60_000
      expect(await until(() => announced > 0)).toBe(true)
      expect(recorded.stopped).toEqual(['one'])

      const settled = announced
      expect(await until(() => announced > settled, 40)).toBe(false)
    } finally {
      idle.halt()
    }
  })
})

const bashCall = (name: string): ToolCall => ({
  callId: toCallId('call-1'),
  name,
  input: { command: 'bun test' },
  effect: EToolEffect.Destructive,
  threadId: toThreadId('thread'),
})

describe('BashActivityHook', () => {
  it('notes a bash call and lets it through untouched', async () => {
    let noted = 0
    const hook = new BashActivityHook({ onBash: () => (noted += 1) })

    const outcome = await hook.run({
      call: bashCall('bash'),
      projectDirectory: '/repo',
      events: [],
      signal: new AbortController().signal,
    })

    expect(noted).toBe(1)
    expect(outcome.decision).toBe(EBeforeToolDecision.Allow)
    if (outcome.decision === EBeforeToolDecision.Allow) {
      expect(outcome.input).toEqual({ command: 'bun test' })
    }
  })

  it('ignores every other tool', async () => {
    let noted = 0
    const hook = new BashActivityHook({ onBash: () => (noted += 1) })

    await hook.run({
      call: bashCall('read'),
      projectDirectory: '/repo',
      events: [],
      signal: new AbortController().signal,
    })

    expect(noted).toBe(0)
  })
})

describe('ReclaimWorktreeSandboxHook', () => {
  const exited = (action: EWorktreeExit) => ({
    ok: true as const,
    output: { exitedWorktree: { path: '/repo/.atlas/worktrees/merged', action } },
    modelText: '',
  })

  it('removes every session’s sandbox anchored at the worktree the session just removed', async () => {
    const { engine: withNetworks, recorded: withNetworksRecorded } = fakeEngine({
      containers: [
        { id: 'gone-a', state: 'running', worktree: '/repo/.atlas/worktrees/merged', session: 'thread-a' },
        { id: 'gone-b', state: 'exited', worktree: '/repo/.atlas/worktrees/merged', session: 'thread-b' },
        { id: 'kept', state: 'running', worktree: '/repo/.atlas/worktrees/live', session: 'thread-c' },
      ],
      networks: [
        { id: 'net-merged', worktree: '/repo/.atlas/worktrees/merged', session: 'thread-a' },
        { id: 'net-live', worktree: '/repo/.atlas/worktrees/live', session: 'thread-c' },
      ],
    })
    const hook = new ReclaimWorktreeSandboxHook({ engine: withNetworks, prefix: 'atlas-test' })

    await hook.run({
      call: bashCall('exit_worktree'),
      result: exited(EWorktreeExit.Remove),
      projectDirectory: '/repo',
      signal: new AbortController().signal,
    })

    expect(withNetworksRecorded.removed).toEqual(['gone-a', 'gone-b'])
    expect(withNetworksRecorded.removedNetworks).toEqual(['net-merged'])
  })

  it('leaves the sandbox alone when the worktree is kept', async () => {
    const { engine, recorded } = fakeEngine({
      containers: [{ id: 'kept', state: 'running', worktree: '/repo/.atlas/worktrees/merged' }],
    })
    const hook = new ReclaimWorktreeSandboxHook({ engine, prefix: 'atlas-test' })

    await hook.run({
      call: bashCall('exit_worktree'),
      result: exited(EWorktreeExit.Keep),
      projectDirectory: '/repo',
      signal: new AbortController().signal,
    })

    expect(recorded.removed).toEqual([])
  })

  it('does nothing for a call that failed or moved no worktree', async () => {
    const { engine, recorded } = fakeEngine({
      containers: [{ id: 'kept', state: 'running', worktree: '/repo/.atlas/worktrees/merged' }],
    })
    const hook = new ReclaimWorktreeSandboxHook({ engine, prefix: 'atlas-test' })
    const signal = new AbortController().signal

    await hook.run({
      call: bashCall('exit_worktree'),
      result: { ok: false, reason: 'refused' },
      projectDirectory: '/repo',
      signal,
    })
    await hook.run({
      call: bashCall('bash'),
      result: { ok: true, output: { command: 'ls' }, modelText: '' },
      projectDirectory: '/repo',
      signal,
    })

    expect(recorded.removed).toEqual([])
  })
})
