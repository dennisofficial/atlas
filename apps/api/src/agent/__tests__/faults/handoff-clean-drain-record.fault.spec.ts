import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig, type ReadEvent } from '../../testing/fault-rig'
import { waitUntil } from '../../testing/handoff-suite'
import { callIdOf, makeFifo, PORT_BAND, portBandOf, waitForFile } from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL
const CALL_ID = 'c1'
const PORT = portBandOf(PORT_BAND.cleanDrainRecord)
const SERVICE = 'a-gated-service'

const rowsOf = async (args: { rig: FaultRig; threadId: string }): Promise<ReadEvent[]> => {
  const page = await args.rig.plane.readEvents({
    threadId: args.threadId,
    afterSeq: 0,
    limit: 1_000,
    visible: false,
  })
  return page.events.map((row) => ({ seq: row.seq, type: row.type, event: row }))
}

const rowsWithCallOf = async (args: {
  rig: FaultRig
  threadId: string
  type: 'tool-dispatched' | 'tool-result'
}): Promise<ReadEvent[]> =>
  (await rowsOf(args)).filter((row) => row.type === args.type && callIdOf(row) === CALL_ID)

const detachedOf = (row: ReadEvent): boolean =>
  (row.event as { detached?: boolean }).detached === true

describe.skipIf(REDIS_URL === undefined)('a clean drain mid plugin call', () => {
  const testDb = useTestDatabase()
  let rig: FaultRig
  let root: string

  beforeAll(async () => {
    rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
    root = mkdtempSync(join(tmpdir(), 'atlas-drain-plugin-'))
  }, 60_000)

  afterAll(async () => {
    await rig.stop()
    rmSync(root, { recursive: true, force: true })
  })

  it('writes no result and no detached dispatch for the call it hands over', async () => {
    const sessionId = 'fault-drain-plugin-1'
    const workspace = join(root, 'workspace')
    const started = join(workspace, 'started')
    const gate = join(workspace, 'gate')
    mkdirSync(workspace, { recursive: true })
    makeFifo({ path: gate })

    const threadId = await rig.newSession({ sessionId, text: 'start the service' })
    const daemon = await rig.spawnDaemonFor({ sessionId })
    const hostA = await rig.spawnHost({
      label: 'host-a',
      daemonUrl: daemon.url,
      workspace,
      knobs: { plugins: true, drainCapMs: 1_000 },
      scripts: {
        [sessionId]: [
          {
            calls: [
              {
                callId: CALL_ID,
                name: 'service',
                input: {
                  action: 'start',
                  command: `touch ${started}; cat ${gate}`,
                  description: SERVICE,
                  workdir: workspace,
                  port: PORT,
                  readyTimeoutMs: 60_000,
                },
              },
            ],
          },
        ],
      },
    })
    await rig.claim({ sessionId, label: 'host-a', timeoutMs: 30_000 })
    await waitUntil({
      what: 'the service call to be dispatched',
      check: async () =>
        (await rowsWithCallOf({ rig, threadId, type: 'tool-dispatched' })).length === 1,
    })
    await waitForFile({ path: started, timeoutMs: 30_000 })
    expect(await rowsWithCallOf({ rig, threadId, type: 'tool-result' })).toEqual([])

    hostA.kill('SIGTERM')
    await hostA.exited

    const drained = await rowsOf({ rig, threadId })
    expect(drained.filter((row) => row.type === 'tool-dispatched')).toHaveLength(1)
    expect(drained.filter((row) => row.type === 'tool-result')).toEqual([])
    expect(drained.filter((row) => row.type === 'tool-dispatched' && detachedOf(row))).toEqual([])
  }, 90_000)
})
