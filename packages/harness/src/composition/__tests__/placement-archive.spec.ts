import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EExecutionLocation, EHarnessPlacement, type SessionPlacement } from '@dltech/atlas-core'
import { EPlacementMoveKind, PlacementController } from '../placement-controller'
import { RandomIds } from '../../store/ids'
import { SessionRegistry } from '../../store/sessions/registry'
import { JsonlEventLog } from '../../store/sessions/event-log'
import { JsonlThreadStore } from '../../store/sessions/thread-store'

describe('a placement transaction spanning archive replacement', () => {
  it('commits against the restored revision while retaining a monotonic published revision', async () => {
    const home = await mkdtemp(join(tmpdir(), 'atlas-placement-archive-'))
    try {
      const registry = new SessionRegistry(home)
      const ids = new RandomIds()
      const clock = { now: () => new Date().toISOString() }
      const log = new JsonlEventLog(home, registry, clock, ids)
      const threads = new JsonlThreadStore(home, registry, clock, ids, log)
      const threadId = ids.nextThreadId()
      await threads.createWithFirstEvents({
        threadId,
        runId: ids.nextRunId(),
        workspace: home,
        drafts: [{ type: 'user-said', text: 'history' }],
      })
      const cloud: SessionPlacement = { harness: EHarnessPlacement.Cloud, driveName: 'scratch-drive' }
      await threads.writePlacement({
        threadId,
        record: { placement: cloud, revision: 12, move: null },
      })
      const placement = new PlacementController(EExecutionLocation.Host)
      placement.bind({ threads, workspace: home, repo: null })
      await placement.activate({ threadId })
      await placement.move({
        threadId,
        target: EExecutionLocation.Host,
        kind: EPlacementMoveKind.Descend,
        work: async (transaction) => {
          await threads.writePlacement({
            threadId,
            record: { placement: cloud, revision: 2, move: null },
          })
          await transaction.commit()
        },
      })
      const landed = await threads.readPlacement({ threadId })
      expect(landed?.placement.harness).toBe(EHarnessPlacement.Host)
      expect(landed?.move).toBeNull()
      expect(landed?.revision).toBeGreaterThan(13)
      expect(placement.current()).toBe(EExecutionLocation.Host)
      expect(placement.snapshot(threadId)).toEqual(landed)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})
