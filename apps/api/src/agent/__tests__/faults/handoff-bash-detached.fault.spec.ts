import { readFileSync, writeFileSync } from 'node:fs'

import { expect } from 'bun:test'

import { callIdOf } from './fault-support'
import { describeHandoff, waitUntil, type HandoffContext } from '../../testing/handoff-suite'
import type { HostProcess, ReadEvent } from '../../testing/fault-rig'

const START_CALL_ID = 'c1'
const HOLD_CALL_ID = 'c2'
const CHECK_CALL_ID = 'c3'

let pidFile = ''
let statusFile = ''

const rowsOf = async (args: {
  ctx: HandoffContext
  type: string
  callId: string
}): Promise<readonly ReadEvent[]> =>
  (await args.ctx.events()).filter((row) => row.type === args.type && callIdOf(row) === args.callId)

describeHandoff({
  name: 'a process that detached from its bash call',
  prompt: 'start a detached process',

  async start(ctx): Promise<HostProcess> {
    const script = ctx.path('detached.sh')
    pidFile = ctx.path('detached-pid')
    statusFile = ctx.path('detached-status')
    const runs = ctx.path('runs')
    const held = ctx.path('held')
    const hold = ctx.gate('hold')
    writeFileSync(script, `echo $$ > ${pidFile}\nexec sleep 60\n`)
    const command = `setsid /bin/sh ${script} >/dev/null 2>&1 & echo run >> ${runs}`
    const hostA = await ctx.rig.spawnHost({
      label: 'host-a',
      daemonUrl: ctx.daemon.url,
      workspace: ctx.workspace,
      scripts: {
        [ctx.sessionId]: [
          {
            calls: [
              {
                callId: START_CALL_ID,
                name: 'bash',
                input: { description: 'start the detached process', command },
              },
            ],
          },
          {
            calls: [
              {
                callId: HOLD_CALL_ID,
                name: 'bash',
                input: { description: 'hold the turn', command: `touch ${held}; cat ${hold}` },
              },
            ],
          },
          { text: 'host a finished' },
        ],
      },
    })
    await ctx.rig.claim({ sessionId: ctx.sessionId, label: 'host-a', timeoutMs: 30_000 })
    await waitUntil({
      what: 'the detached process to start',
      check: async () =>
        (await rowsOf({ ctx, type: 'tool-result', callId: START_CALL_ID })).length === 1,
    })
    await ctx.waitFor('held', 30_000)
    await ctx.waitFor('detached-pid', 30_000)
    return hostA
  },

  takeOverScripts({ sessionId }) {
    return {
      [sessionId]: [
        {
          calls: [
            {
              callId: CHECK_CALL_ID,
              name: 'bash',
              input: {
                description: 'check the detached process',
                command: `p=$(cat ${pidFile}); if kill -0 "$p" 2>/dev/null; then echo alive > ${statusFile}; else echo dead > ${statusFile}; fi`,
              },
            },
          ],
        },
        { text: 'host b finished' },
      ],
    }
  },

  async inFlight(ctx) {
    expect(await rowsOf({ ctx, type: 'tool-result', callId: START_CALL_ID })).toHaveLength(1)
    expect(await rowsOf({ ctx, type: 'tool-result', callId: HOLD_CALL_ID })).toHaveLength(0)
  },

  async release(ctx) {
    await ctx.release('hold')
  },

  async settled(ctx) {
    await waitUntil({
      what: 'the held bash call to report its end',
      check: async () =>
        (await rowsOf({ ctx, type: 'tool-result', callId: HOLD_CALL_ID })).length === 1,
    })
    await waitUntil({
      what: 'the new host to check the detached process',
      check: async () =>
        (await rowsOf({ ctx, type: 'tool-result', callId: CHECK_CALL_ID })).length === 1,
    })
    expect(readFileSync(statusFile, 'utf8').trim()).toBe('alive')
    try {
      process.kill(Number(readFileSync(pidFile, 'utf8').trim()), 'SIGKILL')
    } catch {
      return
    }
  },

  async runs(ctx) {
    return ctx.runCount('runs')
  },
})
