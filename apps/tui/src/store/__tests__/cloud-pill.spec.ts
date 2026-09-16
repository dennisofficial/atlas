import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '@dltech/atlas-core'
import { EChannelConnection, ESandboxState } from '@dltech/atlas-harness'

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

  it('carries the connection state and its detail once attached', () => {
    expect(
      cloudPillOf({
        connection: { state: EChannelConnection.Parked, detail: 'quiet past the TTL' },
      }),
    ).toEqual({ state: EChannelConnection.Parked, detail: 'quiet past the TTL' })
  })

  it('joins the sidebar model only when it is shown', () => {
    const shown = withCloud({
      model: IDLE_SIDEBAR,
      cloud: cloudPillOf({ connection: { state: EChannelConnection.Open, detail: null } }),
    })
    expect(shown.cloud?.state).toBe(EChannelConnection.Open)

    expect(withCloud({ model: IDLE_SIDEBAR, cloud: null }).cloud).toBeUndefined()
  })

  it('treats connecting, reconnecting and parked as resting, and closed as not', () => {
    expect(isResting(EChannelConnection.Connecting)).toBe(true)
    expect(isResting(EChannelConnection.Reconnecting)).toBe(true)
    expect(isResting(EChannelConnection.Parked)).toBe(true)
    expect(isResting(EChannelConnection.Open)).toBe(false)
    expect(isResting(EChannelConnection.Closed)).toBe(false)
  })
})

describe('the container pill in the cloud', () => {
  it('leaves the docker container pill away — the loop is not in a container here', () => {
    expect(
      containerPillOf({ location: EExecutionLocation.Cloud, container: running, exposed: [] }),
    ).toBeNull()
  })
})
