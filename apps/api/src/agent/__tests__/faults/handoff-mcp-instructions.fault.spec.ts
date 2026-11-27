import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { EContextSlot } from '@dltech/atlas-core'
import { expect } from 'bun:test'

import type { HostProcess, ReadEvent } from '../../testing/fault-rig'
import { describeHandoff, POD_EFFECT_WAIT_MS, waitUntil } from '../../testing/handoff-suite'
import { callIdOf } from './fault-support'
import { FIXTURE_INSTRUCTIONS } from './mcp-instructions-fixture'

process.env.ATLAS_API_ORIGIN ??= 'http://127.0.0.1:3400'

const CALL_ID = 'c1'
const SERVER = 'fixture'
const FIXTURE = join(import.meta.dir, 'mcp-instructions-fixture.ts')

const CONFIG = JSON.stringify({
  mcpServers: { [SERVER]: { command: process.execPath, args: [FIXTURE] } },
})

type Snapshot = { seq: number; fingerprint: string }

const snapshotsOf = (rows: readonly ReadEvent[]): Snapshot[] =>
  rows.flatMap((row) => {
    if (row.type !== 'resource-loaded') return []
    const loaded = row.event as { resource?: string; fingerprint?: string }
    return loaded.resource === 'mcp-tools' && loaded.fingerprint !== undefined
      ? [{ seq: row.seq, fingerprint: loaded.fingerprint }]
      : []
  })

type Loaded = { seq: number; content: string }

const instructionsOf = (rows: readonly ReadEvent[]): Loaded[] =>
  rows.flatMap((row) => {
    if (row.type !== 'context-loaded') return []
    const loaded = row.event as { slot?: string; content?: string }
    return loaded.slot === EContextSlot.McpInstructions
      ? [{ seq: row.seq, content: loaded.content ?? '' }]
      : []
  })

type Changed = { seq: number; name: string; status: string }

const changedOf = (rows: readonly ReadEvent[]): Changed[] =>
  rows.flatMap((row) => {
    if (row.type !== 'mcp-server-changed') return []
    const changed = row.event as { row?: { name?: string; status?: string } }
    return [{ seq: row.seq, name: changed.row?.name ?? '', status: changed.row?.status ?? '' }]
  })

const dispatchesOf = (rows: readonly ReadEvent[]): ReadEvent[] =>
  rows.filter((row) => row.type === 'tool-dispatched' && callIdOf(row) === CALL_ID)

const resultsOf = (rows: readonly ReadEvent[]): ReadEvent[] =>
  rows.filter((row) => row.type === 'tool-result' && callIdOf(row) === CALL_ID)

const expectRecordedOnce = (rows: readonly ReadEvent[]): void => {
  const instructions = instructionsOf(rows)
  expect(instructions).toHaveLength(1)
  expect(instructions[0]?.content).toBe(FIXTURE_INSTRUCTIONS)
  const changed = changedOf(rows)
  expect(changed).toHaveLength(1)
  expect(changed[0]).toMatchObject({ name: SERVER, status: 'connected' })
}

describeHandoff({
  name: 'an MCP server keeps its instructions through a host handoff',
  prompt: 'run the gated command',
  knobs: { plugins: true },

  async start(ctx): Promise<HostProcess> {
    writeFileSync(ctx.path('.mcp.json'), `${CONFIG}\n`)
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
    try {
      await waitUntil({
        what: 'the server to record its instructions once',
        check: async () => instructionsOf(await ctx.record()).length === 1,
        timeoutMs: POD_EFFECT_WAIT_MS,
      })
      await waitUntil({
        what: 'the bash call to be dispatched',
        check: async () => dispatchesOf(await ctx.record()).length === 1,
      })
      await ctx.waitFor('started', POD_EFFECT_WAIT_MS)
      return hostA
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`${message}\nhostA logs:\n${hostA.logs().join('\n')}`)
    }
  },

  async inFlight(ctx) {
    const rows = await ctx.record()
    expectRecordedOnce(rows)
    expect(dispatchesOf(rows)).toHaveLength(1)
    expect(resultsOf(rows)).toHaveLength(0)
  },

  async release(ctx) {
    await ctx.release('gate')
  },

  async settled(ctx) {
    await waitUntil({
      what: 'the bash call to report its end',
      check: async () =>
        resultsOf(await ctx.record()).some((row) => {
          const output = (row.event as { output?: { stdout?: string } }).output
          return output?.stdout?.includes('done') === true
        }),
      timeoutMs: POD_EFFECT_WAIT_MS,
    })
    const rows = await ctx.record()
    expectRecordedOnce(rows)
    expect(dispatchesOf(rows)).toHaveLength(1)
    expect(resultsOf(rows)).toHaveLength(1)
  },

  async runs(ctx) {
    return ctx.runCount('runs')
  },

  async interrupted(ctx) {
    await waitUntil({
      what: 'the restarted pod to reload the MCP snapshot',
      check: async () => {
        const snapshots = snapshotsOf(await ctx.record())
        const first = snapshots[0]
        const last = snapshots.at(-1)
        if (first === undefined || last === undefined) return false
        return snapshots.length >= 2 && last.fingerprint !== first.fingerprint
      },
      timeoutMs: POD_EFFECT_WAIT_MS,
    })
    expectRecordedOnce(await ctx.record())
  },
})
