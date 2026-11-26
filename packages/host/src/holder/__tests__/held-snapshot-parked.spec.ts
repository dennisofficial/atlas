import { describe, expect, it } from 'bun:test'

import {
  EHeldAction,
  EWorkspaceStep,
  EWorkspaceStepState,
  type RecordEventBody,
} from '@dltech/atlas-core'

import { eventsOf, posted, snapshotOf } from './held-snapshot-fixture'

const setupStarted = (): RecordEventBody => ({
  type: 'workspace-step',
  step: EWorkspaceStep.Setup,
  state: EWorkspaceStepState.Started,
})

describe('readHeldAction on a parked session', () => {
  it('releases an idle session the operator parked', async () => {
    expect((await snapshotOf({ events: [], parked: true })).action).toBe(EHeldAction.Release)
  })

  it('releases a parked session while its setup script is still in flight', async () => {
    const snapshot = await snapshotOf({ events: eventsOf([setupStarted()]), parked: true })
    expect(snapshot.action).toBe(EHeldAction.Release)
  })

  it('re-joins the setup script instead of releasing an un-parked session', async () => {
    const snapshot = await snapshotOf({ events: eventsOf([setupStarted()]) })
    expect(snapshot.action).toBe(EHeldAction.Prepare)
  })

  it('waits for the running turn of a parked session', async () => {
    const snapshot = await snapshotOf({ events: [], parked: true, turnRunning: true })
    expect(snapshot.action).toBe(EHeldAction.Wait)
  })

  it('starts a turn for a message that reached a parked session', async () => {
    const snapshot = await snapshotOf({ events: eventsOf([posted()]), parked: true })
    expect(snapshot.action).toBe(EHeldAction.StartTurn)
  })
})
