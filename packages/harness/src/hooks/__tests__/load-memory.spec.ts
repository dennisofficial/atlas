import { describe, expect, it } from 'vitest'

import { toThreadId } from '@dltech/atlas-core'
import { EMemoryScope, EMemoryType, type MemorySummary } from '@dltech/atlas-wire'

import { newMemoryIndexState } from '../../memory/memory-index-state'
import { MemoryPort, MemoryUnavailable } from '../../memory/memory-port'
import { MemoryFragment } from '../../prompt/fragments/memory'
import { HOOK_BUDGET_MS } from '../budget'
import { LoadMemoryIndexHook } from '../load-memory'

const summary = (args: { scope: EMemoryScope; name: string }): MemorySummary => ({
  scope: args.scope,
  project: args.scope === EMemoryScope.Project ? 'org/repo' : null,
  name: args.name,
  description: `about ${args.name}`,
  type: EMemoryType.Reference,
  revision: 1,
  updatedAt: '2026-10-20T00:00:00.000Z',
})

class ScriptedPort extends MemoryPort {
  listed = 0
  rows: readonly MemorySummary[] = []
  failure: Error | null = null

  constructor(readonly project: string | null = 'org/repo') {
    super()
  }

  async list(_args?: { timeoutMs?: number | undefined }): Promise<readonly MemorySummary[]> {
    this.listed += 1
    if (this.failure !== null) throw this.failure
    return this.rows
  }

  async read(): Promise<null> {
    return null
  }

  async write(): Promise<MemorySummary> {
    throw new Error('unused')
  }

  async edit(): Promise<MemorySummary> {
    throw new Error('unused')
  }

  async delete(): Promise<boolean> {
    return false
  }
}

const turn = (hook: LoadMemoryIndexHook) =>
  hook.run({ threadId: toThreadId('thr_1'), projectDirectory: '/repo' })

describe('LoadMemoryIndexHook', () => {
  it('splits the listing by scope into the index and emits no drafts', async () => {
    const port = new ScriptedPort()
    port.rows = [
      summary({ scope: EMemoryScope.Project, name: 'deploy' }),
      summary({ scope: EMemoryScope.Global, name: 'prefs' }),
    ]
    const state = newMemoryIndexState()

    const outcome = await turn(new LoadMemoryIndexHook({ port, state }))

    expect(outcome).toEqual({})
    expect(state.text).toBe(
      ['### Global', '- prefs — about prefs', '', '### Project org/repo', '- deploy — about deploy'].join('\n'),
    )
  })

  it('loads once and does not refresh on later turns', async () => {
    const port = new ScriptedPort()
    const hook = new LoadMemoryIndexHook({ port, state: newMemoryIndexState() })

    await turn(hook)
    await turn(hook)
    await turn(hook)

    expect(port.listed).toBe(1)
  })

  it('omits the project section when the port has no project', async () => {
    const state = newMemoryIndexState()

    await turn(new LoadMemoryIndexHook({ port: new ScriptedPort(null), state }))

    expect(state.text).toBe('### Global\n(none yet)')
  })

  it('records unavailability without throwing and retries on the next turn', async () => {
    const port = new ScriptedPort()
    port.failure = new MemoryUnavailable('sign in to Atlas Cloud to use memory')
    const state = newMemoryIndexState()
    const hook = new LoadMemoryIndexHook({ port, state })

    await turn(hook)
    expect(state.text).toBe('Memory is unavailable this session: sign in to Atlas Cloud to use memory.')

    port.failure = null
    port.rows = [summary({ scope: EMemoryScope.Global, name: 'prefs' })]
    await turn(hook)

    expect(port.listed).toBe(2)
    expect(state.text).toContain('- prefs — about prefs')
    await turn(hook)
    expect(port.listed).toBe(2)
  })

  it('turns any unexpected failure into the unavailable text too', async () => {
    const port = new ScriptedPort()
    port.failure = new Error('boom')
    const state = newMemoryIndexState()

    await turn(new LoadMemoryIndexHook({ port, state }))

    expect(state.text).toBe('Memory is unavailable this session: boom.')
  })
})

type Deferred = {
  resolve: (rows: readonly MemorySummary[]) => void
  reject: (error: Error) => void
}

class DeferredPort extends ScriptedPort {
  readonly pending: Deferred[] = []
  readonly timeouts: (number | undefined)[] = []

  override list(args?: { timeoutMs?: number | undefined }): Promise<readonly MemorySummary[]> {
    this.listed += 1
    this.timeouts.push(args?.timeoutMs)
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject })
    })
  }
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30))

const prefs = [summary({ scope: EMemoryScope.Global, name: 'prefs' })]

describe('LoadMemoryIndexHook deadline and concurrency', () => {
  it('hands the port a deadline below the hook budget', async () => {
    const port = new DeferredPort()
    const state = newMemoryIndexState()
    const running = turn(new LoadMemoryIndexHook({ port, state }))

    expect(port.timeouts[0]).toBeLessThan(HOOK_BUDGET_MS)
    port.pending[0]?.resolve(prefs)
    await running
  })

  it('publishes the unavailable text at the deadline and retries on the next turn', async () => {
    const port = new DeferredPort()
    const state = newMemoryIndexState()
    const hook = new LoadMemoryIndexHook({ port, state, deadlineMs: 10 })

    await turn(hook)

    expect(state.text).toContain('Memory is unavailable this session:')
    expect(state.lastFailed).toBe(true)

    const retry = turn(hook)
    expect(port.listed).toBe(2)
    port.pending[1]?.resolve(prefs)
    await retry
    expect(state.lastFailed).toBe(false)
    expect(state.text).toContain('- prefs — about prefs')
  })

  it('ignores a late result from an abandoned attempt', async () => {
    const port = new DeferredPort()
    const state = newMemoryIndexState()
    const hook = new LoadMemoryIndexHook({ port, state, deadlineMs: 10 })

    await turn(hook)
    const unavailable = state.text
    port.pending[0]?.resolve(prefs)
    await settle()

    expect(state.text).toBe(unavailable)
    expect(state.lastFailed).toBe(true)
  })

  it('never lets an abandoned attempt overwrite a newer success, even when it fails late', async () => {
    const port = new DeferredPort()
    const state = newMemoryIndexState()
    const hook = new LoadMemoryIndexHook({ port, state, deadlineMs: 10 })

    await turn(hook)
    const retry = turn(hook)
    port.pending[1]?.resolve(prefs)
    await retry
    const loaded = state.text

    port.pending[0]?.reject(new Error('late failure'))
    await settle()

    expect(state.text).toBe(loaded)
    expect(state.lastFailed).toBe(false)
  })

  it('shares one load between simultaneous turns', async () => {
    const port = new DeferredPort()
    const state = newMemoryIndexState()
    const hooks = [1, 2, 3].map(() => new LoadMemoryIndexHook({ port, state }))

    const running = Promise.all(hooks.map(turn))
    expect(port.listed).toBe(1)
    port.pending[0]?.resolve(prefs)
    await running

    expect(port.listed).toBe(1)
    expect(state.text).toContain('- prefs — about prefs')
    expect(state.loading).toBeNull()
  })

  it('lets a failed shared load be retried afterwards', async () => {
    const port = new DeferredPort()
    const state = newMemoryIndexState()
    const hook = new LoadMemoryIndexHook({ port, state })

    const first = Promise.all([turn(hook), turn(hook)])
    port.pending[0]?.reject(new Error('boom'))
    await first
    expect(state.lastFailed).toBe(true)

    const second = turn(hook)
    expect(port.listed).toBe(2)
    port.pending[1]?.resolve(prefs)
    await second
    expect(state.lastFailed).toBe(false)
  })
})

describe('MemoryFragment over the hook state', () => {
  it('changes its stamp and text once the index loads', async () => {
    const port = new ScriptedPort()
    port.rows = [summary({ scope: EMemoryScope.Global, name: 'prefs' })]
    const state = newMemoryIndexState()
    const fragment = new MemoryFragment({ state })
    const before = fragment.stamp()

    expect(fragment.text()).toContain('Not loaded yet.')

    await turn(new LoadMemoryIndexHook({ port, state }))

    expect(fragment.stamp()).not.toBe(before)
    expect(fragment.stamp()).toBe(state.text ?? '')
    expect(fragment.text()).toContain('## What you remember\n\n### Global\n- prefs — about prefs')
  })

  it('keeps the stamp stable between turns when nothing was reloaded', async () => {
    const port = new ScriptedPort()
    const state = newMemoryIndexState()
    const hook = new LoadMemoryIndexHook({ port, state })
    const fragment = new MemoryFragment({ state })

    await turn(hook)
    const first = fragment.stamp()
    await turn(hook)

    expect(fragment.stamp()).toBe(first)
  })
})
