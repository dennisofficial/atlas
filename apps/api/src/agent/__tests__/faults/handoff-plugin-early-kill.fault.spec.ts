import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'

import {
  dispatchesOf,
  interruptedOf,
  listeningCommandOf,
  podServices,
  resultsOf,
  serviceStartCallOf,
} from './handoff-service-support'
import { PORT_BAND, portBandOf } from './fault-support'
import { startRig } from '../../testing/fault-rig'
import { contextFor, freshWorkspaceOf } from '../../testing/handoff-context'
import { POD_EFFECT_WAIT_MS, waitUntil } from '../../testing/handoff-suite'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL
const PORT = portBandOf(PORT_BAND.pluginEarlyKill)
const RUN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
const TEST_TIMEOUT_MS = 2 * POD_EFFECT_WAIT_MS

describe.skipIf(REDIS_URL === undefined)(
  'handoff: a plugin call killed after its dispatch and before its first pod step',
  () => {
    const testDb = useTestDatabase()

    it(
      'reports it interrupted and never runs its body a second time',
      async () => {
        const root = mkdtempSync(join(tmpdir(), `atlas-early-kill-${RUN}-`))
        const rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
        try {
          const workspace = freshWorkspaceOf({ root, slug: 'early-kill' })
          const sessionId = `handoff-early-kill-${RUN}`
          const threadId = await rig.newSession({ sessionId, text: 'start the service' })
          const daemon = await rig.spawnDaemonFor({ sessionId })
          const ctx = contextFor({ rig, sessionId, threadId, daemon, workspace })
          const held = join(workspace, 'held-before-the-first-pod-step')
          const command = listeningCommandOf({
            started: ctx.path('started'),
            runs: ctx.path('runs'),
            gate: ctx.gate('gate'),
          })
          const hostA = await rig.spawnHost({
            label: 'host-a',
            daemonUrl: daemon.url,
            workspace,
            knobs: {
              plugins: true,
              pluginToolGate: { tool: 'service', waitFor: held, phase: 'before' },
            },
            scripts: {
              [sessionId]: [
                {
                  calls: [
                    serviceStartCallOf({
                      command,
                      description: 'never-started-listener',
                      workdir: workspace,
                      port: PORT,
                    }),
                  ],
                },
                { text: 'host a finished' },
              ],
            },
          })
          await rig.claim({ sessionId, label: 'host-a', timeoutMs: 30_000 })
          await waitUntil({
            what: 'the service call to be dispatched',
            check: async () => (await dispatchesOf(ctx)).length === 1,
          })
          hostA.kill('SIGKILL')
          await hostA.exited

          const hostB = await rig.spawnHost({
            label: 'host-b',
            daemonUrl: daemon.url,
            workspace,
            knobs: { plugins: true },
            scripts: { [sessionId]: [{ text: 'host b finished' }] },
          })
          await rig.claim({ sessionId, label: 'host-b', timeoutMs: 30_000 })
          try {
            await waitUntil({
              what: 'the call to report an interrupted result',
              check: async () => (await resultsOf(ctx)).length === 1,
              timeoutMs: POD_EFFECT_WAIT_MS,
            })
            const results = await resultsOf(ctx)
            expect(results.filter(interruptedOf)).toHaveLength(1)
            expect(await dispatchesOf(ctx)).toHaveLength(1)
            expect(ctx.runCount('runs')).toBe(0)
            expect(await podServices(ctx)).toHaveLength(0)
          } catch (error: unknown) {
            throw new Error(
              `${error instanceof Error ? error.message : String(error)}\nhostB logs:\n${hostB.logs().join('\n')}`,
            )
          }
        } finally {
          await rig.stop()
          rmSync(root, { recursive: true, force: true })
        }
      },
      TEST_TIMEOUT_MS,
    )
  },
)
