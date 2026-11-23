import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EShellEndCause } from '@dltech/atlas-core'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { waitUntil } from '../../testing/handoff-suite'
import { startRig, type FaultRig, type ReadEvent } from '../../testing/fault-rig'
import { postMessage } from './settle-fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

const RUN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

const DECLARED = [
  'services:',
  '  web:',
  `    command: echo run >> runs; bun -e 'Bun.serve({port:Number(process.env.PORT),fetch:()=>new Response("ok")})'`,
  '    port: 4180',
  '',
].join('\n')

const startedWithName = (rows: readonly ReadEvent[], name: string): ReadEvent[] =>
  rows.filter(
    (row) => row.type === 'service-started' && (row.event as { name?: string }).name === name,
  )

const endedWithCause = (rows: readonly ReadEvent[], cause: string): ReadEvent[] =>
  rows.filter(
    (row) => row.type === 'service-ended' && (row.event as { cause?: string }).cause === cause,
  )

describe.skipIf(REDIS_URL === undefined)('a daemon restart brings declared services back', () => {
  const testDb = useTestDatabase()
  let rig: FaultRig
  let root: string

  beforeAll(async () => {
    rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
    root = mkdtempSync(join(tmpdir(), `atlas-preview-restart-${RUN}-`))
  }, 60_000)

  afterAll(async () => {
    await rig.stop()
  })

  it('ends the lost service once and starts it again with the same declaration', async () => {
    const sessionId = `handoff-preview-restart-${RUN}`
    const workspace = join(root, 'workspace')
    mkdirSync(join(workspace, '.atlas'), { recursive: true })
    writeFileSync(join(workspace, '.atlas', 'services.yaml'), DECLARED)
    const threadId = await rig.newSession({ sessionId, text: 'start the web service' })
    const daemon = await rig.spawnDaemonFor({ sessionId })
    const hostA = await rig.spawnHost({
      label: 'host-a',
      daemonUrl: daemon.url,
      workspace,
      knobs: { plugins: true },
      scripts: {
        [sessionId]: [
          {
            calls: [
              {
                callId: 'c1',
                name: 'service',
                input: {
                  action: 'start',
                  description: 'start the declared web service',
                  name: 'web',
                },
              },
            ],
          },
          { text: 'host a started the service' },
        ],
        [`${sessionId}@2`]: [{ text: 'host a is back after the daemon restart' }],
      },
    })
    await rig.claim({ sessionId, label: 'host-a', timeoutMs: 30_000 })

    await rig.waitForSeq({
      threadId,
      want: (rows) => startedWithName(rows, 'web').length === 1,
      timeoutMs: 60_000,
    })

    await waitUntil({
      what: 'host-a to release the idle session',
      timeoutMs: 60_000,
      check: async () => !(await rig.plane.currentLease({ sessionId })).live,
    })

    const beats = rig.panelBeats({ sessionId, ttlMs: 60_000, everyMs: 250 })
    await daemon.restart({ keepHome: true })
    await postMessage({ rig, sessionId, text: 'are the services back?' })
    await rig.wake(sessionId)

    const after = await rig
      .waitForSeq({
        threadId,
        want: (rows) =>
          startedWithName(rows, 'web').length === 2 &&
          endedWithCause(rows, EShellEndCause.SandboxStopped).length === 1,
        timeoutMs: 120_000,
      })
      .catch((error: unknown) => {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}\nhostA logs:\n${hostA.logs().join('\n')}`,
        )
      })
      .finally(() => beats.stop())

    const starts = startedWithName(after, 'web')
    expect(starts).toHaveLength(2)
    expect(endedWithCause(after, EShellEndCause.SandboxStopped)).toHaveLength(1)
    const hashes = starts.map((row) => (row.event as { declarationHash?: string }).declarationHash)
    expect(hashes[0]).toBeDefined()
    expect(hashes[1]).toBe(hashes[0])
    const ports = starts.map((row) => (row.event as { port?: number }).port)
    expect(ports[0]).toBeDefined()
    expect(ports[1]).toBe(ports[0])
    expect(readFileSync(join(workspace, 'runs'), 'utf8').trim().split('\n')).toHaveLength(2)
  }, 240_000)
})
