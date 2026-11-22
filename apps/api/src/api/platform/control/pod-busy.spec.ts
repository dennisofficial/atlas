import { describe, expect, it } from 'bun:test'

import {
  chainEvents,
  ESetupPhase,
  EWorkspaceStep,
  EWorkspaceStepState,
  EPodRebootHold,
  podRebootSafeOf,
  toRunId,
  toThreadId,
  type V2Body,
} from '@dltech/atlas-core'

import { readPodBusy, readPodRebootFacts } from './pod-busy'
import { NOW, setupSessionsService as setup } from './sessions.service.fixture'

const appendIn = async (args: {
  plane: ReturnType<typeof setup>['plane']
  sessionId: string
  threadId: string
  bodies: readonly V2Body[]
}): Promise<void> => {
  const granted = await args.plane.grant({ sessionId: args.sessionId, hostId: 9000 })
  const appended = await args.plane.append({
    threadId: args.threadId,
    epoch: granted.epoch,
    events: chainEvents({
      threadId: toThreadId(args.threadId),
      runId: toRunId('run-0'),
      epoch: granted.epoch,
      at: NOW,
      bodies: args.bodies,
    }),
  })
  if (!appended.ok) throw new Error('the events never landed')
  await args.plane.revoke({ sessionId: args.sessionId, wantsHolder: false })
}

const setupStarted: readonly V2Body[] = [
  {
    type: 'workspace-step',
    step: EWorkspaceStep.Setup,
    state: EWorkspaceStepState.Started,
    command: 'bun install',
  },
  {
    type: 'sandbox-setup-reported',
    text: 'the project setup script started in the background',
    failed: false,
    phase: ESetupPhase.Started,
  },
]

describe('pod busy facts of a session running its setup script', () => {
  it('reads the background setup script as busy while the session is idle', async () => {
    const { plane, service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    const session = { sessionId: created.sessionId, mainThreadId: created.mainThreadId }
    await appendIn({
      plane,
      sessionId: created.sessionId,
      threadId: created.mainThreadId,
      bodies: [{ type: 'workspace-prepared' }, ...setupStarted],
    })
    expect(await readPodBusy({ plane, session })).toEqual({
      busy: true,
      running: ['Setup script'],
    })
    const facts = await readPodRebootFacts({ plane, session })
    expect(facts?.setupRunning).toBe(true)
    expect(facts === undefined ? [] : podRebootSafeOf(facts).holds).toEqual([EPodRebootHold.Setup])
  })

  it('lets go once the setup script reports that it ended', async () => {
    const { plane, service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    const session = { sessionId: created.sessionId, mainThreadId: created.mainThreadId }
    await appendIn({
      plane,
      sessionId: created.sessionId,
      threadId: created.mainThreadId,
      bodies: [
        { type: 'workspace-prepared' },
        ...setupStarted,
        {
          type: 'sandbox-setup-reported',
          text: 'the project setup script finished after 40s',
          failed: false,
          phase: ESetupPhase.Finished,
        },
      ],
    })
    expect(await readPodBusy({ plane, session })).toEqual({ busy: false, running: [] })
    const facts = await readPodRebootFacts({ plane, session })
    expect(facts?.setupRunning).toBe(false)
  })
})
