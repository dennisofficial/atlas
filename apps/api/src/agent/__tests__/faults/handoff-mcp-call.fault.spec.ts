import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect } from 'bun:test'

import type { HostProcess, ReadEvent } from '../../testing/fault-rig'
import {
  describeHandoff,
  POD_EFFECT_WAIT_MS,
  waitUntil,
  type HandoffContext,
  type HandoffScenario,
} from '../../testing/handoff-suite'
import { callIdOf } from './fault-support'
import { FIXTURE_ANSWER, FIXTURE_TOOL } from './mcp-effect-fixture'

process.env.ATLAS_API_ORIGIN ??= 'http://127.0.0.1:3400'

const SERVER = 'fixture'
const TOOL = `mcp__${SERVER}__${FIXTURE_TOOL}`
const FIXTURE = join(import.meta.dir, 'mcp-effect-fixture.ts')
const WARMUP_CALL_ID = 'c1'
const CALL_ID = 'c2'
const KNOBS = { plugins: true, drainCapMs: 1_000 }
const OUTAGE_MS = 4_000

type ResultEvent = { modelText?: string; interrupted?: boolean; error?: { message: string } }

const dispatchesOf = async (ctx: HandoffContext): Promise<ReadEvent[]> =>
  (await ctx.events()).filter((row) => row.type === 'tool-dispatched' && callIdOf(row) === CALL_ID)

const resultsOf = async (ctx: HandoffContext): Promise<ReadEvent[]> =>
  (await ctx.events()).filter((row) => row.type === 'tool-result' && callIdOf(row) === CALL_ID)

const resultOf = async (ctx: HandoffContext): Promise<ResultEvent> => {
  const [first] = await resultsOf(ctx)
  if (first === undefined) throw new Error('the MCP call reported no result')
  return first.event as ResultEvent
}

const interruptedOf = (row: ReadEvent): boolean => {
  const event = row.event as { interrupted?: boolean; error?: { message: string } }
  if (event.interrupted === true) return true
  return event.error !== undefined && /interrupt/i.test(event.error.message)
}

const snapshotsOf = async (ctx: HandoffContext): Promise<number> =>
  (await ctx.record()).filter((row) => {
    if (row.type !== 'resource-loaded') return false
    const loaded = row.event as { resource?: string; fingerprint?: string }
    return loaded.resource === 'mcp-tools' && loaded.fingerprint !== undefined
  }).length

const configOf = (args: { runs: string; started: string; gate: string }): string =>
  JSON.stringify({
    mcpServers: {
      [SERVER]: {
        command: process.execPath,
        args: [FIXTURE, args.runs, args.started, args.gate],
      },
    },
  })

const startMcpCall = async (ctx: HandoffContext): Promise<HostProcess> => {
  const runs = ctx.path('runs')
  const started = ctx.path('started')
  const gate = ctx.gate('gate')
  const ready = ctx.gate('ready')
  writeFileSync(ctx.path('.mcp.json'), `${configOf({ runs, started, gate })}\n`)
  const hostA = await ctx.rig.spawnHost({
    label: 'host-a',
    daemonUrl: ctx.daemon.url,
    workspace: ctx.workspace,
    knobs: KNOBS,
    scripts: {
      [ctx.sessionId]: [
        {
          calls: [
            {
              callId: WARMUP_CALL_ID,
              name: 'bash',
              input: { description: 'wait for the tool list', command: `cat '${ready}'` },
            },
          ],
        },
        { calls: [{ callId: CALL_ID, name: TOOL, input: {} }] },
        { text: 'host a finished' },
      ],
    },
  })
  await ctx.rig.claim({ sessionId: ctx.sessionId, label: 'host-a', timeoutMs: 30_000 })
  try {
    await waitUntil({
      what: 'the MCP tool snapshot to load',
      check: async () => (await snapshotsOf(ctx)) >= 1,
      timeoutMs: 90_000,
    })
    await ctx.release('ready')
    await waitUntil({
      what: 'the fixture server to be dispatched the MCP call',
      check: async () => (await dispatchesOf(ctx)).length === 1,
    })
    await ctx.waitFor('started', 30_000)
    return hostA
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${message}\nhostA logs:\n${hostA.logs().join('\n')}`)
  }
}

const scenarioOf = (args: {
  name: string
  beforeClaim?: (ctx: HandoffContext, hostB: HostProcess) => Promise<void>
}): HandoffScenario => ({
  name: args.name,
  prompt: 'call the counting tool',
  knobs: KNOBS,
  start: startMcpCall,
  ...(args.beforeClaim === undefined ? {} : { beforeClaim: args.beforeClaim }),

  async inFlight(ctx) {
    expect(await dispatchesOf(ctx)).toHaveLength(1)
    expect(await resultsOf(ctx)).toHaveLength(0)
  },

  async release(ctx) {
    ctx.daemon.proxy.clear()
    await ctx.release('gate')
  },

  async settled(ctx) {
    await waitUntil({
      what: 'the MCP call to report the real answer',
      check: async () => (await resultsOf(ctx)).length === 1,
      timeoutMs: POD_EFFECT_WAIT_MS,
    })
    const results = await resultsOf(ctx)
    expect(results.filter(interruptedOf)).toHaveLength(0)
    expect(await dispatchesOf(ctx)).toHaveLength(1)
    const result = await resultOf(ctx)
    expect(result.error).toBeUndefined()
    expect(result.modelText ?? '').toContain(FIXTURE_ANSWER)
  },

  async runs(ctx) {
    return ctx.runCount('runs')
  },

  async interrupted(ctx) {
    await waitUntil({
      what: 'the interrupted MCP result',
      check: async () => (await resultsOf(ctx)).length === 1,
      timeoutMs: POD_EFFECT_WAIT_MS,
    })
    const results = await resultsOf(ctx)
    expect(results.filter(interruptedOf)).toHaveLength(1)
    const result = await resultOf(ctx)
    expect(result.modelText ?? '').not.toContain(FIXTURE_ANSWER)
    expect(await dispatchesOf(ctx)).toHaveLength(1)
  },
})

describeHandoff(scenarioOf({ name: 'an MCP tool call that outlives the turn' }))

describeHandoff(
  scenarioOf({
    name: 'an MCP tool call whose host handoff meets the pod link down',
    beforeClaim: (ctx) => {
      ctx.daemon.proxy.set({ blackhole: true })
      setTimeout(() => {
        ctx.daemon.proxy.drop()
        ctx.daemon.proxy.clear()
      }, OUTAGE_MS)
      return Promise.resolve()
    },
  }),
)
