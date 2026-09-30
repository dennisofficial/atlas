import { describe, expect, it } from 'bun:test'

import { theme } from '../../ui/theme'
import type { ThreadChip, ThreadRow } from '../../ui/threads-model'
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
} from '@dltech/atlas-harness'
import { openThreadChips } from '../thread-chips'

const HOME = '/repo'

const checkout = (args: { directory: string; branch: string }): RepositoryCheckout => ({
  directory: args.directory,
  branch: args.branch,
  forge: EForge.GitHub,
  remote: { host: 'github.com', owner: 'dennis', repo: 'atlas' },
})

const found = (args: { number: number; state?: EPullRequestState }): PullRequestReading => ({
  lookup: EPullRequestLookup.Found,
  pullRequest: {
    number: args.number,
    title: 'a pull request',
    url: `https://github.com/dennis/atlas/pull/${String(args.number)}`,
    state: args.state ?? EPullRequestState.Open,
    checks: EChecksState.None,
    tally: NO_CHECKS,
  },
})

const link = (args: { number: number; branch: string; repo?: string }) => ({
  number: args.number,
  url: `https://github.com/dennis/atlas/pull/${args.number}`,
  repo: args.repo ?? 'github.com/dennis/atlas',
  branch: args.branch,
})

const row = (args: {
  threadId: string
  worktree?: { path: string; branch: string }
  pullRequests?: readonly ReturnType<typeof link>[]
}): ThreadRow => ({
  threadId: args.threadId,
  label: args.threadId,
  titled: false,
  updatedAt: '2026-08-25T12:00:00.000Z',
  active: false,
  ...(args.worktree === undefined ? {} : { worktree: args.worktree }),
  ...(args.pullRequests === undefined ? {} : { pullRequests: args.pullRequests }),
})

class CachedFakePullRequests extends PullRequestPort {
  readonly pushes = false
  readonly freshened: string[] = []
  private readonly badges = new Map<string, PullRequestReading>()
  private readonly listeners = new Set<() => void>()

  constructor(held: Readonly<Record<string, PullRequestReading>>) {
    super()
    for (const [key, reading] of Object.entries(held)) this.badges.set(key, reading)
  }

  async read(): Promise<PullRequestReading> {
    return { lookup: EPullRequestLookup.Unavailable, retryable: true }
  }
  async readLinked(): Promise<PullRequestReading> {
    return { lookup: EPullRequestLookup.Unavailable, retryable: true }
  }

  override peekBadge(args: PullRequestBadgeKey): PullRequestReading | null {
    const key =
      args.kind === 'checkout' ? checkoutKey(args.checkout) : `${args.repo}#${args.number}`
    return this.badges.get(key) ?? null
  }

  override freshenBadge(args: PullRequestBadgeKey): void {
    this.freshened.push(
      args.kind === 'checkout' ? checkoutKey(args.checkout) : `${args.repo}#${args.number}`,
    )
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

const settleMicrotasks = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('the incremental pills of an open picker', () => {
  it('paints cached badges the moment they are known, without waiting on any read', async () => {
    const main = checkout({ directory: HOME, branch: 'main' })
    const port = new CachedFakePullRequests({ [checkoutKey(main)]: found({ number: 401 }) })
    const landed: Array<Map<string, readonly ThreadChip[]>> = []

    const handle = openThreadChips({
      home: HOME,
      pullRequests: port,
      probe: async () => main,
      onLanded: (chips) => landed.push(chips),
    })

    const rows = [
      row({ threadId: 't1' }),
      row({ threadId: 't2', pullRequests: [link({ number: 402, branch: 'dennis/linked' })] }),
    ]
    port.push('github.com/dennis/atlas#402', found({ number: 402 }))

    const chips = handle.sync({ rows })
    expect(chips.get('t2')?.map((chip: ThreadChip) => chip.label)).toEqual(['#402'])

    await settleMicrotasks()
    const painted = landed.flatMap((map) => [...map.keys()])
    expect(painted).toContain('t1')
    handle.stop()
  })

  it('lands a pushed badge on the open rows without a resync', async () => {
    const port = new CachedFakePullRequests({})
    const landed: Array<Map<string, readonly ThreadChip[]>> = []

    const handle = openThreadChips({
      home: HOME,
      pullRequests: port,
      probe: async () => null,
      onLanded: (chips) => landed.push(chips),
    })

    handle.sync({
      rows: [row({ threadId: 't1', pullRequests: [link({ number: 403, branch: 'dennis/third' })] })],
    })
    port.push('github.com/dennis/atlas#403', found({ number: 403 }))
    await settleMicrotasks()

    expect(landed.length).toBe(1)
    expect(landed[0]?.get('t1')?.[0]?.ground).toBe(theme.link)
    handle.stop()
  })

  it('a probe landing decorates every row sharing its directory, not just the first', async () => {
    const main = checkout({ directory: HOME, branch: 'main' })
    const port = new CachedFakePullRequests({ [checkoutKey(main)]: found({ number: 404 }) })
    const landed: Array<Map<string, readonly ThreadChip[]>> = []

    const handle = openThreadChips({
      home: HOME,
      pullRequests: port,
      probe: async () => main,
      onLanded: (chips) => landed.push(chips),
    })

    const first = handle.sync({ rows: [row({ threadId: 't1' }), row({ threadId: 't2' })] })
    expect(first.get('t1')).toEqual([])
    expect(first.get('t2')).toEqual([])

    await settleMicrotasks()

    const painted = landed.flatMap((map) => [...map.keys()])
    expect(painted).toContain('t1')
    expect(painted).toContain('t2')
    const last = landed.at(-1)
    expect(last?.get('t1')?.length).toBeGreaterThan(0)
    expect(last?.get('t2')?.length).toBeGreaterThan(0)
    handle.stop()
  })

  it('stops answering once closed', async () => {
    const port = new CachedFakePullRequests({})
    const landed: Array<Map<string, readonly ThreadChip[]>> = []

    const handle = openThreadChips({
      home: HOME,
      pullRequests: port,
      probe: async () => null,
      onLanded: (chips) => landed.push(chips),
    })

    handle.sync({
      rows: [row({ threadId: 't1', pullRequests: [link({ number: 405, branch: 'dennis/fifth' })] })],
    })
    handle.stop()
    port.push('github.com/dennis/atlas#405', found({ number: 405 }))
    await settleMicrotasks()

    expect(landed.length).toBe(0)
  })
})
