import { beforeEach, describe, expect, it } from 'bun:test'
import type { V2Body } from '@dltech/atlas-core'

import { ControlPlane } from '../../control-plane'
import { createSessionParams, HOLDER_HOST, mint, SESSION, T0, THREAD } from './support'
import type { ConformanceParams } from './conformance'

export function describeControlPlaneStartFailures(params: ConformanceParams): void {
  describe(`ControlPlane start failures (${params.name})`, () => {
    let plane: ControlPlane

    beforeEach(async () => {
      await params.reset()
      plane = new ControlPlane({ store: params.makeStore(), clock: () => T0 })
      await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
    })

    const appendAs = async (args: { bodies: V2Body[]; wantsHolder: boolean }): Promise<void> => {
      const { epoch } = await plane.grant({
        sessionId: SESSION,
        hostId: HOLDER_HOST,
      })
      const outcome = await plane.append({
        threadId: THREAD,
        epoch,
        events: mint({
          bodies: args.bodies,
          epoch,
          from: await plane.head({ threadId: THREAD }),
        }),
      })
      if (!outcome.ok) throw new Error(JSON.stringify(outcome.refusal))
      await plane.revoke({ sessionId: SESSION, wantsHolder: args.wantsHolder })
    }

    const failStart = (inboxHead: number, wantsHolder = false): Promise<void> =>
      appendAs({
        bodies: [
          {
            type: 'session-start-failed',
            reason: 'no sandbox',
            inboxHead,
            permanent: true,
          },
        ],
        wantsHolder,
      })

    const post = (kind: string): Promise<unknown> =>
      plane.post({
        sessionId: SESSION,
        kind,
        payload: kind === 'stop' ? '{}' : '"m"',
      })

    const needing = (): Promise<string[]> => plane.sessionsNeedingHolder({ limit: 10 })

    it('does not list a start-failed session until a newer message arrives', async () => {
      await appendAs({
        bodies: [{ type: 'workspace-prepared' }],
        wantsHolder: false,
      })
      await post('message')
      await failStart(1)
      expect(await needing()).toEqual([])
      await post('message')
      expect(await needing()).toEqual([SESSION])
    })

    it('lists a start-failed session again for a stop', async () => {
      await appendAs({
        bodies: [{ type: 'workspace-prepared' }],
        wantsHolder: false,
      })
      await post('message')
      await failStart(1)
      await post('stop')
      expect(await needing()).toEqual([SESSION])
    })

    it('treats a failure ended by a later turn as no failure', async () => {
      await appendAs({
        bodies: [{ type: 'workspace-prepared' }],
        wantsHolder: false,
      })
      await failStart(0)
      await appendAs({
        bodies: [{ type: 'user-said', text: 'hi' }],
        wantsHolder: false,
      })
      await post('message')
      expect(await needing()).toEqual([SESSION])
    })
  })
}
