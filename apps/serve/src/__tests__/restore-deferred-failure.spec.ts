import { describe, expect, it } from 'bun:test'
import {
  EExecutionLocation,
  EHarnessPlacement,
  EPlacementMovePhase,
  placementOf,
  type PlacementRecord,
} from '@dltech/atlas-core'
import {
  EClientFrame,
  EClientRequest,
  EServeFrame,
  PlacementController,
} from '@dltech/atlas-harness'
import { fakeServeApp } from './fakes'
import {
  bootRestoreServe,
  freshRestoreHome,
  RESTORE_THREAD,
  seedArchive,
  settle,
  wireRealLog,
} from './restore-fixture'

const failedHydration = (): PlacementController => {
  const preparing: PlacementRecord = {
    placement: placementOf(EExecutionLocation.Host),
    revision: 1,
    move: {
      id: 'preparing-lift',
      phase: EPlacementMovePhase.Preparing,
      from: placementOf(EExecutionLocation.Host),
      to: { harness: EHarnessPlacement.Cloud },
    },
  }
  const controller = new PlacementController(EExecutionLocation.Host)
  controller.bind({
    workspace: '/workspace',
    repo: null,
    threads: {
      readPlacement: async () => preparing,
      writePlacement: async () => {
        throw new Error('placement hydration conflict')
      },
      onPlacementChanged: () => () => undefined,
      find: async () => undefined,
    },
  })
  return controller
}

describe('requests deferred behind a rejected restore', () => {
  it('answers every deferred request and reports rejected sends without an unhandled rejection', async () => {
    const home = freshRestoreHome()
    const archive = await seedArchive({ texts: ['history'] })
    const app = fakeServeApp({ threadId: RESTORE_THREAD, root: '/workspace' })
    wireRealLog({ home, app })
    let held = Promise.resolve()
    let release = (): void => undefined
    const { client } = await bootRestoreServe({
      home,
      app,
      archive: async () => {
        await held
        return archive
      },
    })
    app.executionLocation = failedHydration()
    held = new Promise<void>((resolve) => {
      release = resolve
    })
    client.send({
      kind: EClientFrame.Request,
      id: 'restore-reject',
      op: EClientRequest.RestoreTranscript,
      params: {},
    })
    client.send({
      kind: EClientFrame.Request,
      id: 'deferred-read',
      op: EClientRequest.ReadEvents,
      params: { threadId: RESTORE_THREAD },
    })
    client.send({
      kind: EClientFrame.Send,
      sendId: 'deferred-send' as never,
      text: 'retain this draft',
    })
    await settle()
    release()
    for (const replyTo of ['restore-reject', 'deferred-read']) {
      const reply = await client.waitFor(
        (frame) => frame.kind === EServeFrame.Reply && frame.replyTo === replyTo,
      )
      if (reply.kind !== EServeFrame.Reply) throw new Error('expected a reply')
      expect(reply.ok).toBe(false)
      expect(JSON.stringify(reply.data)).toContain('placement hydration conflict')
    }
    const failure = await client.waitFor(
      (frame) =>
        frame.kind === EServeFrame.Error && frame.message.includes('placement hydration conflict'),
    )
    expect(failure.kind).toBe(EServeFrame.Error)
  })
})
