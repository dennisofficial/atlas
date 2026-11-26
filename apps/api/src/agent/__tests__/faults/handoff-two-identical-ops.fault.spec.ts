import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'

import { DOUBLE_EXEC_TOOL } from '../../testing/fault-tools'
import { startRig, type ReadEvent } from '../../testing/fault-rig'
import { contextFor, freshWorkspaceOf } from '../../testing/handoff-context'
import { waitUntil } from '../../testing/handoff-suite'
import { callIdOf } from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL
const CALL_ID = 'c1'
const RUN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
const KNOBS = { plugins: true, faultTools: true }

describe.skipIf(REDIS_URL === undefined)(
  'handoff: a plugin tool that runs the same pod op twice',
  () => {
    const testDb = useTestDatabase()

    it('runs the op twice in all, never a third time, when its host dies mid-second', async () => {
      const root = mkdtempSync(join(tmpdir(), `atlas-two-ops-${RUN}-`))
      const rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
      try {
        const workspace = freshWorkspaceOf({ root, slug: 'two-ops' })
        const sessionId = `handoff-two-ops-${RUN}`
        const threadId = await rig.newSession({ sessionId, text: 'run it twice' })
        const daemon = await rig.spawnDaemonFor({ sessionId })
        const ctx = contextFor({ rig, sessionId, threadId, daemon, workspace })
        const resultsOf = async (): Promise<readonly ReadEvent[]> => {
          const page = await rig.plane.readEvents({
            threadId,
            afterSeq: 0,
            limit: 1_000,
            visible: true,
          })
          return page.events
            .map((row) => ({ seq: row.seq, type: row.type, event: row }))
            .filter((row) => row.type === 'tool-result' && callIdOf(row) === CALL_ID)
        }
        const command = `echo run >> ${ctx.path('runs')}; while [ ! -f ${ctx.path('gate')} ]; do sleep 0.05; done`
        const hostA = await rig.spawnHost({
          label: 'host-a',
          daemonUrl: daemon.url,
          workspace,
          knobs: KNOBS,
          scripts: {
            [sessionId]: [
              { calls: [{ callId: CALL_ID, name: DOUBLE_EXEC_TOOL, input: { command } }] },
              { text: 'host a finished' },
            ],
          },
        })
        await rig.claim({ sessionId, label: 'host-a', timeoutMs: 30_000 })
        await waitUntil({
          what: 'the first op to finish and the second to block',
          check: async () => ctx.runCount('runs') === 1,
        })
        hostA.kill('SIGKILL')
        await hostA.exited

        const hostB = await rig.spawnHost({
          label: 'host-b',
          daemonUrl: daemon.url,
          workspace,
          knobs: KNOBS,
          scripts: { [sessionId]: [{ text: 'host b finished' }] },
        })
        await rig.claim({ sessionId, label: 'host-b', timeoutMs: 30_000 })
        try {
          writeFileSync(ctx.path('gate'), '')
          await waitUntil({
            what: 'the call to report its result',
            check: async () => (await resultsOf()).length === 1,
          })
          const results = await resultsOf()
          expect(
            results.map((row) => (row.event as { interrupted?: boolean }).interrupted),
          ).toEqual([undefined])
          expect(ctx.runCount('runs')).toBe(2)
        } catch (error: unknown) {
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}\nhostB logs:\n${hostB.logs().join('\n')}`,
          )
        }
      } finally {
        await rig.stop()
        rmSync(root, { recursive: true, force: true })
      }
    }, 90_000)
  },
)
