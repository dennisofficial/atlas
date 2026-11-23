import { beforeEach, describe, expect, it } from 'bun:test'
import {
  ECompactionAnchor,
  ESetupPhase,
  EWorkspaceStep,
  EWorkspaceStepState,
  type V2Body,
} from '@dltech/atlas-core'

import { decodeViewState } from '../../session-view-codec'
import type { ConformanceParams } from './conformance'
import {
  appendBodies,
  makeHarness,
  said,
  seedGranted,
  SESSION,
  THREAD,
  type Harness,
} from './support'

const setupStep = (state: EWorkspaceStepState): V2Body => ({
  type: 'workspace-step',
  step: EWorkspaceStep.Setup,
  state,
  command: 'bun install',
  attempt: 1,
})

const setupReport = (phase: ESetupPhase): V2Body => ({
  type: 'sandbox-setup-reported',
  text: `setup ${phase}`,
  failed: false,
  phase,
})

export function describeControlPlaneDurableViews(params: ConformanceParams): void {
  describe(`ControlPlane durable view facts (${params.name})`, () => {
    let harness: Harness
    let epoch: number

    beforeEach(async () => {
      await params.reset()
      harness = makeHarness(params.makeStore())
      epoch = await seedGranted(harness)
    })

    const storedFacts = async () => {
      let facts: ReturnType<typeof decodeViewState>
      await params.makeStore().transact(async (tx) => {
        const row = await tx.readSessionView(SESSION)
        facts = row === undefined ? undefined : decodeViewState(row.state)
      })
      return facts?.facts
    }

    it('settles a setup whose ending a summary hid', async () => {
      await appendBodies({
        harness,
        epoch,
        bodies: [
          { type: 'workspace-attempt-started', attempt: 1 },
          setupStep(EWorkspaceStepState.Started),
          setupReport(ESetupPhase.Started),
          said('go'),
          setupStep(EWorkspaceStepState.Done),
          setupReport(ESetupPhase.Finished),
          said('next'),
        ],
      })
      await harness.plane.readSessionView({ sessionId: SESSION, threadId: THREAD })
      await appendBodies({
        harness,
        epoch,
        bodies: [
          {
            type: 'history-summarised',
            fromSeq: 3,
            throughSeq: 6,
            anchor: ECompactionAnchor.Prefix,
            summary: 'setup ran',
          },
        ],
      })
      await harness.plane.readSessionView({ sessionId: SESSION, threadId: THREAD })
      expect((await storedFacts())?.setupRun).toBeNull()
    })
  })
}
