import { afterEach, describe, expect, it } from 'bun:test'
import { EExecutionLocation, EPlacementMovePhase, toThreadId } from '@dltech/atlas-core'

import { openStoreFixture, type StoreFixture } from '../../store/__tests__/harness'
import { EPlacementMoveKind, PlacementController } from '../placement-controller'

const held: StoreFixture[] = []
afterEach(async () => { for (const fixture of held.splice(0)) await fixture.close() })

describe('placement moves owned by the current process', () => {
  it('recognizes only a move still running, so a committed warning can be recovered without restarting', async () => {
    const fixture = openStoreFixture()
    held.push(fixture)
    const threadId = toThreadId('brn_active_move')
    const controller = new PlacementController(EExecutionLocation.Host)
    controller.bind({ threads: fixture.threads, workspace: '/work', repo: '/work' })
    await controller.activate({ threadId })
    let id = ''
    await expect(controller.move({
      threadId,
      target: EExecutionLocation.Cloud,
      kind: EPlacementMoveKind.Lift,
      work: async (transaction) => {
        id = controller.snapshot(threadId)?.move?.id ?? ''
        expect(controller.startedHere(id)).toBe(true)
        await transaction.commit()
        throw new Error('activation is pending')
      },
    })).rejects.toThrow('activation is pending')
    expect(controller.startedHere(id)).toBe(false)
    expect(controller.snapshot(threadId)?.move?.phase).toBe(EPlacementMovePhase.Committed)
  })
})
