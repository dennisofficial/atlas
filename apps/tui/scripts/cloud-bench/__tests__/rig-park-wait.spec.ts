import { describe, expect, test } from 'bun:test'

import type { ChannelWatch } from '../rig-observer'
import { type ParkWaitContext, waitForPark } from '../rig-park-wait'
import type { BoxProbe } from '../rig-probes'

const runningProbe = (logTail: string): BoxProbe => ({
  provider: 'running',
  running: true,
  record: null,
  recordError: null,
  version: 'dev-abc123',
  protocol: 25,
  servePid: '41',
  logTail,
})

const stoppedProbe = (provider: string): BoxProbe => ({
  provider,
  running: false,
  record: null,
  recordError: null,
  version: null,
  protocol: null,
  servePid: null,
  logTail: null,
})

type Script = {
  probes: readonly (BoxProbe | Error)[]
  phases: readonly (string | null)[]
  views: readonly string[]
}

const rigged = (script: Script) => {
  let poll = 0
  const boxCalls: { name: string; logLines?: number | undefined }[] = []
  const at = <T>(list: readonly T[]): T => {
    const item = list[Math.min(poll, list.length - 1)]
    if (item === undefined) throw new Error('empty script')
    return item
  }
  const ctx: ParkWaitContext = {
    probes: {
      box: async (args) => {
        boxCalls.push(args)
        const next = at(script.probes)
        poll += 1
        if (next instanceof Error) throw next
        return next
      },
    },
    rig: () => ({ channel: () => ({ connection: () => ({ state: at(script.views) }) }) }),
    sandboxName: () => 'atlas-thr-rig',
    log: () => undefined,
  }
  const watch: ChannelWatch = {
    views: () => [...script.views],
    checkpoints: () => [],
    lastPhase: () => at(script.phases),
    stop: () => undefined,
  }
  return { ctx, watch, boxCalls }
}

describe('waitForPark', () => {
  test('resolves once the client record is parked and the provider has left running', async () => {
    const { ctx, watch, boxCalls } = rigged({
      probes: [runningProbe('tail one'), runningProbe('tail two'), stoppedProbe('snapshotting')],
      phases: ['serving', 'parked', 'parked'],
      views: ['connected', 'parked', 'parked'],
    })

    const result = await waitForPark({ ctx, watch, within: 5_000, every: 5 })

    expect(result.provider).toBe('snapshotting')
    expect(result.parkedAtMs).not.toBeNull()
    expect(result.lastLogTail).toBe('tail two')
    expect(result.observations.map((row) => [row.view, row.phase, row.provider])).toEqual([
      ['connected', 'serving', 'running'],
      ['parked', 'parked', 'running'],
      ['parked', 'parked', 'snapshotting'],
    ])
    expect(result.observations[0]?.stamps).toBe('dev-abc123 / protocol 25')
    expect(result.observations[2]?.stamps).toBeNull()
    expect(boxCalls).toEqual([
      { name: 'atlas-thr-rig', logLines: 60 },
      { name: 'atlas-thr-rig', logLines: 60 },
      { name: 'atlas-thr-rig', logLines: 60 },
    ])
  })

  test('a stopped provider alone does not count as a park', async () => {
    const { ctx, watch } = rigged({
      probes: [stoppedProbe('stopped')],
      phases: ['serving'],
      views: ['reconnecting'],
    })

    const result = await waitForPark({ ctx, watch, within: 40, every: 5 })

    expect(result.parkedAtMs).toBeNull()
    expect(result.provider).toBe('stopped')
    expect(result.lastLogTail).toBeNull()
    expect(result.observations.length).toBeGreaterThan(1)
    expect(result.observations.every((row) => row.phase === 'serving')).toBe(true)
  })

  test('times out with everything it saw when the box never stops', async () => {
    const { ctx, watch } = rigged({
      probes: [runningProbe('only tail')],
      phases: ['parked'],
      views: ['parked'],
    })

    const result = await waitForPark({ ctx, watch, within: 30, every: 5 })

    expect(result.parkedAtMs).toBeNull()
    expect(result.provider).toBe('running')
    expect(result.lastLogTail).toBe('only tail')
    expect(result.observations.length).toBeGreaterThan(1)
  })

  test('a failed probe is recorded and the wait keeps polling', async () => {
    const { ctx, watch } = rigged({
      probes: [new Error('get timed out'), stoppedProbe('stopped')],
      phases: ['parked'],
      views: ['parked'],
    })

    const result = await waitForPark({ ctx, watch, within: 5_000, every: 5 })

    expect(result.parkedAtMs).not.toBeNull()
    expect(result.observations[0]?.provider).toBeNull()
    expect(result.observations[0]?.note).toContain('get timed out')
    expect(result.provider).toBe('stopped')
  })

  test('a missing channel reads as no view rather than throwing', async () => {
    const { ctx, watch } = rigged({
      probes: [stoppedProbe('stopped')],
      phases: ['parked'],
      views: ['parked'],
    })
    const detached: ParkWaitContext = { ...ctx, rig: () => ({ channel: () => null }) }

    const result = await waitForPark({ ctx: detached, watch, within: 5_000, every: 5 })

    expect(result.observations[0]?.view).toBeNull()
    expect(result.parkedAtMs).not.toBeNull()
  })
})
