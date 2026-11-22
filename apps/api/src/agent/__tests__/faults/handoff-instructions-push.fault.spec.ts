import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EMessageOrigin, type ResourceLoaded } from '@dltech/atlas-core'
import { INBOX_KIND_MESSAGE } from '@dltech/atlas-protocol'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig, type HostProcess, type ReadEvent } from '../../testing/fault-rig'
import { describeHandoff, waitUntil } from '../../testing/handoff-suite'
import { callIdOf, isDoneResult } from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

const RUN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

const INSTRUCTIONS = 'instructions'
const CALL_ID = 'c1'
const ORIGINAL = 'the repository said this before the push'
const MARKER = 'PUSHED-BY-THE-DAEMON'
const HOST_B_TEXT = 'host b finished'

type Snapshot = { seq: number; loaded: ResourceLoaded }

const snapshotsOf = (rows: readonly ReadEvent[]): Snapshot[] =>
  rows.flatMap((row) => {
    if (row.type !== 'resource-loaded') return []
    const loaded = row.event as ResourceLoaded
    return loaded.resource === INSTRUCTIONS ? [{ seq: row.seq, loaded }] : []
  })

const pushedOf = (rows: readonly ReadEvent[]): Snapshot[] =>
  snapshotsOf(rows).filter((snapshot) => JSON.stringify(snapshot.loaded.value).includes(MARKER))

const dispatchesOf = (rows: readonly ReadEvent[]): ReadEvent[] =>
  rows.filter((row) => row.type === 'tool-dispatched' && callIdOf(row) === CALL_ID)

const resultsOf = (rows: readonly ReadEvent[]): ReadEvent[] =>
  rows.filter((row) => row.type === 'tool-result' && callIdOf(row) === CALL_ID)

const hasSaid = (rows: readonly ReadEvent[], text: string): boolean =>
  rows.some((row) => row.type === 'assistant-said' && JSON.stringify(row.event).includes(text))

const answersOf = (rows: readonly ReadEvent[]): number =>
  rows.filter((row) => row.type === 'assistant-said').length

const seqSaidOf = (rows: readonly ReadEvent[], text: string): number => {
  const row = rows.find(
    (candidate) =>
      candidate.type === 'assistant-said' && JSON.stringify(candidate.event).includes(text),
  )
  if (row === undefined) throw new Error(`the record never carried the text "${text}"`)
  return row.seq
}

const onlyOf = <T>(items: readonly T[], what: string): T => {
  const first = items[0]
  if (first === undefined || items.length !== 1) {
    throw new Error(`expected exactly one ${what}, the record held ${items.length}`)
  }
  return first
}

const recordOf = async (args: {
  plane: FaultRig['plane']
  threadId: string
}): Promise<ReadEvent[]> => {
  const page = await args.plane.readEvents({
    threadId: args.threadId,
    afterSeq: 0,
    limit: 1_000,
    visible: false,
  })
  return page.events.map((row) => ({ seq: row.seq, type: row.type, event: row }))
}

const waitForRecord = async (args: {
  ctx: { record(): Promise<ReadEvent[]> }
  what: string
  check: (rows: readonly ReadEvent[]) => boolean
  timeoutMs?: number
}): Promise<void> => {
  await waitUntil({
    what: args.what,
    check: async () => args.check(await args.ctx.record()),
    ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
  })
}

const waitWithLogs = async (args: {
  host: HostProcess
  what: string
  check: () => Promise<boolean>
  timeoutMs?: number
}): Promise<void> => {
  try {
    await waitUntil({
      what: args.what,
      check: args.check,
      ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${message}\n${args.host.label} logs:\n${args.host.logs().join('\n')}`)
  }
}

describeHandoff({
  name: 'an instructions file pushed by the daemon outlives the turn it arrived in',
  prompt: 'run the gated command',
  knobs: { plugins: true },

  async start(ctx): Promise<HostProcess> {
    writeFileSync(ctx.path('AGENTS.md'), `${ORIGINAL}\n`)
    const started = ctx.path('started')
    const runs = ctx.path('runs')
    const gate = ctx.gate('gate')
    const bash = `touch ${started}; echo run >> ${runs}; cat ${gate}; echo done`
    const hostA = await ctx.rig.spawnHost({
      label: 'host-a',
      daemonUrl: ctx.daemon.url,
      workspace: ctx.workspace,
      knobs: { plugins: true },
      scripts: {
        [ctx.sessionId]: [
          {
            calls: [
              { callId: CALL_ID, name: 'bash', input: { description: 'gated', command: bash } },
            ],
          },
          { text: 'host a finished' },
        ],
      },
    })
    await ctx.rig.claim({ sessionId: ctx.sessionId, label: 'host-a', timeoutMs: 30_000 })
    await waitWithLogs({
      host: hostA,
      what: 'the first instructions snapshot',
      check: async () => snapshotsOf(await ctx.record()).length === 1,
    })
    await waitForRecord({
      ctx,
      what: 'the bash call to be dispatched',
      check: (rows) => dispatchesOf(rows).length === 1,
    })
    await ctx.waitFor('started', 30_000)
    writeFileSync(ctx.path('AGENTS.md'), `${ORIGINAL}\n${MARKER}\n`)
    await waitForRecord({
      ctx,
      what: 'the pushed change to be recorded',
      check: (rows) => pushedOf(rows).length >= 1,
    })
    return hostA
  },

  async inFlight(ctx) {
    const rows = await ctx.record()
    expect(snapshotsOf(rows).length).toBeGreaterThanOrEqual(1)
    expect(pushedOf(rows)).toHaveLength(1)
    expect(dispatchesOf(rows)).toHaveLength(1)
    expect(resultsOf(rows)).toHaveLength(0)
  },

  async release(ctx) {
    await ctx.release('gate')
  },

  async settled(ctx) {
    await waitUntil({
      what: 'the bash call to report its end',
      check: async () => resultsOf(await ctx.record()).filter(isDoneResult).length === 1,
    })
    await waitUntil({
      what: 'the next model call after the handoff',
      check: async () => hasSaid(await ctx.record(), HOST_B_TEXT),
    })
    const rows = await ctx.record()
    const pushed = onlyOf(pushedOf(rows), 'pushed instructions snapshot')
    expect(JSON.stringify(snapshotsOf(rows).at(-1)?.loaded.value)).toContain(MARKER)
    expect(seqSaidOf(rows, HOST_B_TEXT)).toBeGreaterThan(pushed.seq)
    expect(dispatchesOf(rows)).toHaveLength(1)
    expect(resultsOf(rows)).toHaveLength(1)
  },

  async runs(ctx) {
    return ctx.runCount('runs')
  },

  async interrupted(ctx) {
    await waitUntil({
      what: 'the restarted pod to record the instructions again',
      check: async () => {
        const snapshots = snapshotsOf(await ctx.record())
        const first = snapshots[0]
        const last = snapshots.at(-1)
        if (first === undefined || last === undefined) return false
        return snapshots.length >= 2 && last.loaded.fingerprint !== first.loaded.fingerprint
      },
      timeoutMs: 60_000,
    })
    const rows = await ctx.record()
    expect(JSON.stringify(snapshotsOf(rows).at(-1)?.loaded.value)).toContain(MARKER)
    const results = resultsOf(rows)
    expect(results).toHaveLength(1)
    expect((results[0]?.event as { interrupted?: boolean } | undefined)?.interrupted).toBe(true)
    expect(dispatchesOf(rows)).toHaveLength(1)
  },
})

describe.skipIf(REDIS_URL === undefined)(
  'a wake that reconnects to the same daemon instance',
  () => {
    const testDb = useTestDatabase()
    let rig: FaultRig
    let root: string | undefined

    beforeAll(async () => {
      rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
    }, 60_000)

    afterAll(async () => {
      await rig.stop()
      if (root !== undefined) rmSync(root, { recursive: true, force: true })
    })

    it('reloads nothing when the next turn runs on the same daemon instance', async () => {
      root = mkdtempSync(join(tmpdir(), 'atlas-instructions-wake-'))
      const workspace = join(root, 'workspace')
      mkdirSync(workspace, { recursive: true })
      writeFileSync(join(workspace, 'AGENTS.md'), `${ORIGINAL}\n`)
      const sessionId = `fault-instructions-wake-${RUN}`
      const threadId = await rig.newSession({ sessionId, text: 'the first turn' })
      const daemon = await rig.spawnDaemonFor({ sessionId })
      const bootId = daemon.bootId
      await rig.spawnHost({
        label: 'host-a',
        daemonUrl: daemon.url,
        workspace,
        knobs: { plugins: true },
        scripts: {
          [sessionId]: [{ text: 'first turn done' }, { text: 'second turn done' }],
        },
      })
      await rig.claim({ sessionId, label: 'host-a', timeoutMs: 30_000 })
      const recorded = async (): Promise<ReadEvent[]> =>
        await recordOf({ plane: rig.plane, threadId })
      await waitUntil({
        what: 'the first turn',
        check: async () => hasSaid(await recorded(), 'first turn done'),
      })
      await waitUntil({
        what: 'the first instructions snapshot',
        check: async () => snapshotsOf(await recorded()).length === 1,
      })

      await rig.plane.post({
        sessionId,
        kind: INBOX_KIND_MESSAGE,
        payload: JSON.stringify({ text: 'the second turn', via: EMessageOrigin.Operator }),
      })
      await waitUntil({
        what: 'the second turn to reach its model call',
        check: async () => answersOf(await recorded()) >= 2,
        timeoutMs: 45_000,
      })
      expect(daemon.bootId).toBe(bootId)
      expect(snapshotsOf(await recorded())).toHaveLength(1)
    }, 120_000)
  },
)
