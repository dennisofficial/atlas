import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'
import { EMessageOrigin } from '@dltech/atlas-core'
import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig } from '../../testing/fault-rig'
import { describeHandoff, waitUntil, type HandoffContext } from '../../testing/handoff-suite'
import type { HostProcess } from '../../testing/fault-rig'
import { callIdOf, isDoneResult } from './fault-support'

const CALL_ID = 'c1'
const PLAN = { path: 'plan.md', text: 'the plan the spawner attached' }
const CONTEXT = (ctx: HandoffContext): string =>
  `${ctx.rig.sandboxHome}/sessions/${ctx.sessionId}/context/${PLAN.path}`

const dispatchesOf = async (ctx: HandoffContext) =>
  (await ctx.events()).filter((row) => row.type === 'tool-dispatched' && callIdOf(row) === CALL_ID)

const resultsOf = async (ctx: HandoffContext) =>
  (await ctx.events()).filter((row) => row.type === 'tool-result' && callIdOf(row) === CALL_ID)

describeHandoff({
  name: 'context files a spawner attached before the first turn',
  prompt: 'read the plan',
  prepared: false,
  files: [PLAN],

  async start(ctx): Promise<HostProcess> {
    const runs = ctx.path('runs')
    const gate = ctx.gate('gate')
    const bash = `cat ${CONTEXT(ctx)} >> ${runs}; cat ${gate}; echo done`
    const hostA = await ctx.rig.spawnHost({
      label: 'host-a',
      daemonUrl: ctx.daemon.url,
      workspace: ctx.workspace,
      scripts: {
        [ctx.sessionId]: [
          {
            calls: [
              { callId: CALL_ID, name: 'bash', input: { description: 'read', command: bash } },
            ],
          },
          { text: 'host a finished' },
        ],
      },
    })
    await ctx.rig.claim({ sessionId: ctx.sessionId, label: 'host-a', timeoutMs: 30_000 })
    await waitUntil({
      what: 'the bash call to be dispatched with the attached file in place',
      check: async () => (await dispatchesOf(ctx)).length === 1,
    })
    await waitUntil({
      what: 'the bash call to read the attached file',
      check: async () => ctx.runCount('runs') === 1,
    })
    return hostA
  },

  async inFlight(ctx) {
    expect(await dispatchesOf(ctx)).toHaveLength(1)
    expect(await resultsOf(ctx)).toHaveLength(0)
    expect(ctx.runCount('runs')).toBe(1)
  },

  async release(ctx) {
    await ctx.release('gate')
  },

  async settled(ctx) {
    await waitUntil({
      what: 'the bash call to report its end',
      check: async () => (await resultsOf(ctx)).filter(isDoneResult).length === 1,
    })
    expect(await resultsOf(ctx)).toHaveLength(1)
    expect(ctx.runCount('runs')).toBe(1)
  },

  async runs(ctx) {
    return ctx.runCount('runs')
  },

  async interrupted(ctx) {
    await waitUntil({
      what: 'the bash result',
      check: async () => (await resultsOf(ctx)).length === 1,
    })
    expect((await resultsOf(ctx)).filter(isDoneResult)).toHaveLength(0)
    expect(ctx.runCount('runs')).toBe(1)
  },
})

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL
const RUN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

const SLEEP_MS = 150

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

describe.skipIf(REDIS_URL === undefined)(
  'handoff: attached context files on a replacement pod',
  () => {
    const testDb = useTestDatabase()

    it('fails the first placement, then restores the exact bytes on a pod that lost its disk', async () => {
      const root = mkdtempSync(join(tmpdir(), `atlas-lost-disk-${RUN}-`))
      const workspace = join(root, 'workspace')
      mkdirSync(workspace, { recursive: true })
      const runs = join(workspace, 'runs')
      const sessionId = `handoff-lost-disk-${RUN}`
      const rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
      const sessionDir = `${rig.sandboxHome}/sessions/${sessionId}`
      const contextDirectory = `${sessionDir}/context`
      const contextFile = `${contextDirectory}/${PLAN.path}`
      const blockFirstPlacementWithPlainFileAsContextFolder = (): void => {
        mkdirSync(sessionDir, { recursive: true })
        writeFileSync(contextDirectory, 'not a folder')
      }
      blockFirstPlacementWithPlainFileAsContextFolder()

      const threadId = await rig.newSession({
        sessionId,
        text: 'read the plan',
        prepared: false,
        files: [PLAN],
      })
      const record = async () => {
        const page = await rig.plane.readEvents({
          threadId,
          afterSeq: 0,
          limit: 1_000,
          visible: false,
        })
        return page.events
      }
      try {
        const daemon = await rig.spawnDaemonFor({ sessionId })
        const scripts = {
          [sessionId]: [
            {
              calls: [
                {
                  callId: CALL_ID,
                  name: 'bash',
                  input: {
                    description: 'read the plan',
                    command: `test -f ${contextFile} && cat ${contextFile} >> ${runs}; echo done`,
                  },
                },
              ],
            },
            { text: 'the plan is back' },
          ],
        }
        const hostA = await rig.spawnHost({
          label: 'host-a',
          daemonUrl: daemon.url,
          workspace,
          scripts,
        })
        await rig.claim({ sessionId, label: 'host-a', timeoutMs: 30_000 })
        await waitUntil({
          what: 'the first host to give up on placing the attached files',
          check: async () =>
            (await record()).some((event) => event.type === 'workspace-prepare-failed'),
        })
        expect((await record()).some((event) => event.type === 'tool-dispatched')).toBe(false)

        hostA.kill('SIGKILL')
        await hostA.exited
        await daemon.restart({ keepHome: false })
        rmSync(sessionDir, { recursive: true, force: true })
        expect(existsSync(contextFile)).toBe(false)

        await rig.spawnHost({
          label: 'host-b',
          daemonUrl: daemon.url,
          workspace,
          scripts,
        })
        await rig.plane.post({
          sessionId,
          kind: 'message',
          payload: JSON.stringify({ text: 'try the plan again', via: EMessageOrigin.Operator }),
        })
        await rig.claim({ sessionId, label: 'host-b', timeoutMs: 30_000 })

        await waitUntil({
          what: 'the replacement host to read the restored file',
          check: async () => existsSync(runs) && readFileSync(runs, 'utf8').trim() !== '',
        })
        expect(readFileSync(runs, 'utf8')).toBe(PLAN.text)
        await waitUntil({
          what: 'the replacement host to answer',
          check: async () => (await record()).some((event) => event.type === 'assistant-said'),
        })
        await sleep(SLEEP_MS)
        expect(
          readFileSync(runs, 'utf8')
            .split('\n')
            .filter((line) => line !== '').length,
        ).toBe(1)
      } finally {
        await rig.stop()
        rmSync(sessionDir, { recursive: true, force: true })
        rmSync(root, { recursive: true, force: true })
      }
    }, 90_000)
  },
)
