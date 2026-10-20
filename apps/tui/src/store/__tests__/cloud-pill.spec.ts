import { describe, expect, it } from 'bun:test'

import { EConnectionView } from '@dltech/atlas-harness'

import { cloudPillOf, isResting } from '../cloud-state'
import { IDLE_SIDEBAR, withCloud } from '../sidebar-model'

describe('the cloud pill', () => {
  it('is absent until the session has attached', () => {
    expect(cloudPillOf({ connection: null })).toBeNull()
  })

  it('carries the connection state once attached', () => {
    expect(
      cloudPillOf({
        connection: { state: EConnectionView.Parked, detail: null },
      }),
    ).toEqual({ state: EConnectionView.Parked })
  })

  it('is hidden once the session has detached', () => {
    expect(cloudPillOf({ connection: { state: EConnectionView.Detached, detail: null } })).toBeNull()
  })

  it('joins the sidebar model only when it is shown', () => {
    const shown = withCloud({
      model: IDLE_SIDEBAR,
      cloud: cloudPillOf({ connection: { state: EConnectionView.Connected, detail: null } }),
    })
    expect(shown.cloud?.state).toBe(EConnectionView.Connected)

    expect(withCloud({ model: IDLE_SIDEBAR, cloud: null }).cloud).toBeUndefined()
  })

  it('treats waking, reconnecting, updating and parked as resting — parked is never a fault', () => {
    expect(isResting(EConnectionView.Waking)).toBe(true)
    expect(isResting(EConnectionView.Reconnecting)).toBe(true)
    expect(isResting(EConnectionView.Updating)).toBe(true)
    expect(isResting(EConnectionView.Parked)).toBe(true)
    expect(isResting(EConnectionView.Connected)).toBe(false)
    expect(isResting(EConnectionView.Disconnected)).toBe(false)
    expect(isResting(EConnectionView.Detached)).toBe(false)
  })
})
