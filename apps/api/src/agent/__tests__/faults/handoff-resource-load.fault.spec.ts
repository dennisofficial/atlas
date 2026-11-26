import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'

import { startRig, type ReadEvent } from '../../testing/fault-rig'
import { FAULT_LOAD_RESOURCE } from '../../testing/fault-resources'
import { contextFor, freshWorkspaceOf } from '../../testing/handoff-context'
import { waitUntil } from '../../testing/handoff-suite'
import { postMessage } from './settle-fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL
const RUN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
const KNOBS = { plugins: true, faultTools: true, faultResources: true }

const loadedLinesOf = (rows: readonly ReadEvent[]): number[] =>
  rows.flatMap((row) => {
    if (row.type !== 'resource-loaded') return []
    const loaded = row.event as { resource?: string; value?: { lines?: number } }
    if (loaded.resource !== FAULT_LOAD_RESOURCE) return []
    return loaded.value?.lines === undefined ? [] : [loaded.value.lines]
  })

const saidOf = (rows: readonly ReadEvent[]): string =>
  rows
    .filter((row) => row.type === 'assistant-said')
    .map((row) => JSON.stringify(row.event))
    .join('\n')

describe.skipIf(REDIS_URL === undefined)('handoff: a resource load a later turn runs again', () => {
  const testDb = useTestDatabase()

  it('gives the turn after the handoff a run of its own, and never the first turn result', async () => {
    const root = mkdtempSync(join(tmpdir(), `atlas-resource-load-${RUN}-`))
    const rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
    try {
      const workspace = freshWorkspaceOf({ root, slug: 'resource-load' })
      const sessionId = `handoff-resource-load-${RUN}`
      const threadId = await rig.newSession({ sessionId, text: 'first turn' })
      const daemon = await rig.spawnDaemonFor({ sessionId })
      const ctx = contextFor({ rig, sessionId, threadId, daemon, workspace })
      const record = async (): Promise<ReadEvent[]> => ctx.events()
      const loadGate = ctx.path('gate')
      ctx.path('loads')
      writeFileSync(loadGate, '')
      const hostA = await rig.spawnHost({
        label: 'host-a',
        daemonUrl: daemon.url,
        workspace,
        knobs: KNOBS,
        scripts: {
          [sessionId]: [{ text: 'host a first' }, { text: 'host a second' }],
        },
      })
      await rig.claim({ sessionId, label: 'host-a', timeoutMs: 30_000 })
      try {
        await waitUntil({
          what: 'the first turn to load the resource',
          timeoutMs: 30_000,
          check: async () => loadedLinesOf(await record()).length === 1,
        })
      } catch (error: unknown) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}\nevents: ${JSON.stringify((await record()).map((row) => row.type))}\nloads: ${ctx.runCount('loads')}\nhostA logs:\n${hostA.logs().slice(-40).join('\n')}`,
        )
      }
      expect(loadedLinesOf(await record())).toEqual([1])

      rmSync(loadGate)
      await postMessage({ rig, sessionId, text: 'second turn' })
      await rig.wake(sessionId)
      await waitUntil({
        what: 'the second turn to begin on the first host',
        timeoutMs: 20_000,
        check: async () =>
          ctx.runCount('loads') >= 2 ||
          saidOf(await record()).includes('host a second') ||
          (await record()).filter((row) => row.type === 'turn-started').length === 2,
      }).catch(() => undefined)
      expect(saidOf(await record())).toContain('host a first')

      hostA.kill('SIGKILL')
      await hostA.exited
      await postMessage({ rig, sessionId, text: 'third turn' })
      const hostB = await rig.spawnHost({
        label: 'host-b',
        daemonUrl: daemon.url,
        workspace,
        knobs: KNOBS,
        scripts: { [sessionId]: [{ text: 'host b second' }] },
      })
      await rig.claim({ sessionId, label: 'host-b', timeoutMs: 30_000 })
      try {
        writeFileSync(loadGate, '')
        await waitUntil({
          what: 'the holder after the handoff to record a load of its own',
          timeoutMs: 90_000,
          check: async () => loadedLinesOf(await record()).some((lines) => lines > 1),
        })
        await waitUntil({
          what: 'the holder after the handoff to answer its turn',
          timeoutMs: 60_000,
          check: async () => saidOf(await record()).includes('host b second'),
        })
        const loaded = loadedLinesOf(await record())
        expect(loaded[0]).toBe(1)
        expect(loaded.at(-1)).toBeGreaterThan(1)
        expect(saidOf(await record())).toContain('host b second')
      } catch (error: unknown) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}\nloads: ${ctx.runCount('loads')}\nloaded: ${JSON.stringify(loadedLinesOf(await record()))}\nsaid: ${saidOf(await record())}\nevents: ${JSON.stringify((await record()).map((row) => row.type))}\nhostB logs:\n${hostB.logs().join('\n')}`,
        )
      }
    } finally {
      await rig.stop()
      rmSync(root, { recursive: true, force: true })
    }
  }, 180_000)
})
