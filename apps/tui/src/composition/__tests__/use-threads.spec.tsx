import { projectOf, toThreadId } from '@dltech/atlas-core'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React from 'react'

import {
  checkoutKey,
  EForge,
  EPullRequestLookup,
  EPullRequestState,
  EChecksState,
  NO_CHECKS,
  PullRequestPort,
  type PullRequestBadgeKey,
  type PullRequestReading,
  type RepositoryCheckout,
  type ThreadSummary,
} from '@dltech/atlas-harness'
import { settle, teardown } from '../../ui/markdown/__tests__/harness'
import type { ThreadsState } from '../../ui/threads-model'
import type { AtlasApp } from '../compose'
import { useThreads, type ThreadsControl } from '../use-threads'

const AT = '2026-08-27T00:00:00.000Z'

const summary = (args: {
  id: string
  title?: string
  worktree?: { path: string; branch: string }
  pullRequests?: ThreadSummary['pullRequests']
}): ThreadSummary =>
  ({
    id: toThreadId(args.id),
    head: 0,
    createdAt: AT,
    updatedAt: AT,
    workspace: '/repo',
    repo: null,
    ...(args.title === undefined ? {} : { title: args.title }),
    ...(args.worktree === undefined ? {} : { worktree: args.worktree }),
    ...(args.pullRequests === undefined ? {} : { pullRequests: args.pullRequests }),
  }) as ThreadSummary

class BadgePort extends PullRequestPort {
  readonly pushes = false
  readonly freshened: string[] = []
  private readonly badges = new Map<string, PullRequestReading>()
  private readonly listeners = new Set<() => void>()

  async read(): Promise<PullRequestReading> {
    return { lookup: EPullRequestLookup.Unavailable, retryable: true }
  }
  async readLinked(): Promise<PullRequestReading> {
    return { lookup: EPullRequestLookup.Unavailable, retryable: true }
  }
  override peekBadge(args: PullRequestBadgeKey): PullRequestReading | null {
    return this.badges.get(keyOf(args)) ?? null
  }
  override freshenBadge(args: PullRequestBadgeKey): void {
    this.freshened.push(keyOf(args))
  }
  override onBadges(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  push(key: string, reading: PullRequestReading): void {
    this.badges.set(key, reading)
    for (const listener of this.listeners) listener()
  }
}

const keyOf = (args: PullRequestBadgeKey): string =>
  args.kind === 'checkout' ? checkoutKey(args.checkout) : `${args.repo}#${args.number}`

const found = (args: { number: number }): PullRequestReading => ({
  lookup: EPullRequestLookup.Found,
  pullRequest: {
    number: args.number,
    title: 'a pull request',
    url: `https://github.com/dennis/atlas/pull/${args.number}`,
    state: EPullRequestState.Open,
    checks: EChecksState.None,
    tally: NO_CHECKS,
  },
})

type ListingCall = {
  onUpdate: ((threads: readonly ThreadSummary[]) => void) | undefined
  enrich: readonly string[] | undefined
}

type Probe = { control: ThreadsControl | null }

function Picker(props: { probe: Probe; app: AtlasApp; listing: () => { list: unknown } }): React.ReactNode {
  const control = useThreads({
    app: props.app,
    project: projectOf(props.app.workspace),
    activeThreadId: 'active-thread',
    onPick: () => undefined,
    listing: props.listing as never,
  })
  props.probe.control = control
  return <text>{control.state === null ? 'closed' : `open ${control.state.rows.length}`}</text>
}

const appStub = (pullRequests: PullRequestPort | null): AtlasApp =>
  ({
    config: { cwd: '/repo' },
    workspace: { workspace: '/repo', repo: null },
    pullRequests,
    threads: { list: async () => [] },
  }) as unknown as AtlasApp

const render = async (
  app: AtlasApp,
  calls: ListingCall[],
  resolved: readonly ThreadSummary[],
): Promise<{ probe: Probe; setup: Awaited<ReturnType<typeof testRender>> }> => {
  const probe: Probe = { control: null }
  const setup = await testRender(
    <Picker
      probe={probe}
      app={app}
      listing={() => ({
        list: (args: {
          onUpdate?: (threads: readonly ThreadSummary[]) => void
          enrich?: readonly string[]
        }) => {
          calls.push({ onUpdate: args.onUpdate, enrich: args.enrich })
          return Promise.resolve(resolved)
        },
      })}
    />,
    { width: 120, height: 30 },
  )
  await flushAll(setup)
  return { probe, setup }
}

const flushAll = async (setup: Awaited<ReturnType<typeof testRender>>): Promise<void> => {
  await setup.flush()
  await settle(10)
  await setup.flush()
}

const controlOf = (probe: Probe): ThreadsControl => {
  if (probe.control === null) throw new Error('the probe never mounted')
  return probe.control
}


describe('the incremental conversation picker', () => {
  it('paints the first onUpdate page before the listing promise resolves', async () => {
    const calls: ListingCall[] = []
    const { probe, setup } = await render(appStub(null), calls, [])
    try {
      controlOf(probe).handleOpen()
      await flushAll(setup)

      const update = calls[0]?.onUpdate
      expect(update).toBeDefined()

      update?.([summary({ id: 't1', title: 'first' })])
      await flushAll(setup)

      const state = controlOf(probe).state
      expect(state?.loading).toBe(false)
      expect(state?.rows.map((row) => row.label)).toEqual(['first'])
    } finally {
      teardown(setup)
    }
  })

  it('keeps the typed query and selection across enrichment updates', async () => {
    const calls: ListingCall[] = []
    const { probe, setup } = await render(appStub(null), calls, [])
    try {
      controlOf(probe).handleOpen()
      await flushAll(setup)

      calls[0]?.onUpdate?.([summary({ id: 'alpha' }), summary({ id: 'beta' })])
      await flushAll(setup)

      controlOf(probe).handleKey({ name: 'down' } as never)
      await flushAll(setup)
      expect(controlOf(probe).state?.index).toBe(1)
      expect(controlOf(probe).state?.rows.length).toBe(2)

      calls[0]?.onUpdate?.([summary({ id: 'alpha', title: 'alpha named' }), summary({ id: 'beta' })])
      await flushAll(setup)

      const state = controlOf(probe).state
      expect(state?.index).toBe(1)
      expect(state?.rows[0]?.label).toBe('alpha named')
    } finally {
      teardown(setup)
    }
  })

  it('drops an obsolete update that lands after a reopen', async () => {
    const calls: ListingCall[] = []
    const { probe, setup } = await render(appStub(null), calls, [])
    try {
      controlOf(probe).handleOpen()
      await flushAll(setup)

      const stale = calls[0]?.onUpdate

      controlOf(probe).handleDismiss()
      await flushAll(setup)
      controlOf(probe).handleOpen()
      await flushAll(setup)

      stale?.([summary({ id: 'stale', title: 'stale page' })])
      await flushAll(setup)

      expect(calls.length).toBe(2)
      expect(controlOf(probe).state?.rows.map((row) => row.label)).toEqual([])
    } finally {
      teardown(setup)
    }
  })

  it('freshens each row once across repeated updates, and lands pushed chips', async () => {
    const port = new BadgePort()
    port.push('github.com/dennis/atlas#401', found({ number: 401 }))

    const calls: ListingCall[] = []
    const { probe, setup } = await render(appStub(port), calls, [])
    try {
      const rows = [
        summary({
          id: 't1',
          title: 'linked',
          pullRequests: [
            { number: 401, url: 'https://github.com/dennis/atlas/pull/401', repo: 'github.com/dennis/atlas', branch: 'dennis/first' },
          ],
        }),
      ]

      controlOf(probe).handleOpen()
      await flushAll(setup)

      calls[0]?.onUpdate?.(rows)
      await flushAll(setup)
      await settle(20)
      await flushAll(setup)

      const withChip = controlOf(probe).state?.rows[0]
      expect(withChip?.chips?.map((chip) => chip.label)).toEqual(['#401'])

      const freshenedAfterFirst = port.freshened.length
      calls[0]?.onUpdate?.(rows)
      await flushAll(setup)
      await settle(20)
      await flushAll(setup)

      expect(port.freshened.length).toBe(freshenedAfterFirst)
    } finally {
      teardown(setup)
    }
  })

  it('a badge push after dismiss never paints', async () => {
    const port = new BadgePort()
    const calls: ListingCall[] = []
    const { probe, setup } = await render(appStub(port), calls, [])
    try {
      controlOf(probe).handleOpen()
      await flushAll(setup)

      calls[0]?.onUpdate?.([
        summary({
          id: 't1',
          pullRequests: [
            { number: 402, url: 'https://github.com/dennis/atlas/pull/402', repo: 'github.com/dennis/atlas', branch: 'dennis/second' },
          ],
        }),
      ])
      await flushAll(setup)
      await settle(20)

      controlOf(probe).handleDismiss()
      await flushAll(setup)

      port.push('github.com/dennis/atlas#402', found({ number: 402 }))
      await settle(20)
      await flushAll(setup)

      expect(controlOf(probe).state).toBeNull()
    } finally {
      teardown(setup)
    }
  })

  it('enriches the visible window once, and re-asks when the selection moves past it', async () => {
    const calls: ListingCall[] = []
    const { probe, setup } = await render(appStub(null), calls, [])
    try {
      controlOf(probe).handleOpen()
      await flushAll(setup)

      const rows = Array.from({ length: 20 }, (_, i) => summary({ id: `t${i}`, title: `row ${i}` }))
      calls[0]?.onUpdate?.(rows)
      await flushAll(setup)
      await settle(20)
      await flushAll(setup)

      const enrichCalls = () => calls.filter((call) => call.enrich !== undefined && call.enrich.length > 0)
      const firstWave = enrichCalls()
      expect(firstWave.length).toBe(1)
      expect(firstWave[0]?.enrich).toContain('t0')
      expect(firstWave[0]?.enrich).not.toContain('t19')

      for (let i = 0; i < 15; i += 1) controlOf(probe).handleKey({ name: 'down' } as never)
      await flushAll(setup)
      await settle(20)
      await flushAll(setup)

      const laterWave = enrichCalls()
      expect(laterWave.length).toBe(2)
      expect(laterWave[1]?.enrich).toContain('t19')
    } finally {
      teardown(setup)
    }
  })
})
