import { describe, expect, it } from 'vitest'

import { EExecutionLocation } from '@dltech/atlas-core'
import { EConnectionView, ESandboxState } from '@dltech/atlas-harness'

import { cloudPillOf, isResting } from '../cloud-state'
import { containerPillOf, IDLE_SIDEBAR, withCloud, type SidebarContainer } from '../sidebar-model'

const running: SidebarContainer = {
  state: ESandboxState.Running,
  image: 'node:22-slim',
  label: 'node:22-slim',
  ports: [],
}

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
    expect(
      cloudPillOf({ connection: { state: EConnectionView.Detached, detail: null } }),
    ).toBeNull()
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

describe('the container pill in the cloud', () => {
  it('leaves the docker container pill away — the loop is not in a container here', () => {
    expect(
      containerPillOf({ location: EExecutionLocation.Cloud, container: running, exposed: [] }),
    ).toBeNull()
  })
})
