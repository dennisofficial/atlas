import { describe, expect, test } from 'bun:test'

import { EConnectionView } from '@dltech/atlas-client/channel'
import { ETerminalConnection } from '@dltech/atlas-ui/ai/terminal-states'
import { EPodState, type PodStatus } from '@dltech/atlas-wire/web'

import { podDetailOf, terminalConnectionOf } from '../terminal-connection'

const pod = (state: EPodState, resources?: PodStatus['resources']): PodStatus => ({
  state,
  steps: [],
  ...(resources === undefined ? {} : { resources }),
})

const view = (state: EConnectionView) => ({ state, detail: null })

describe('terminalConnectionOf', () => {
  test('a parked pod is paused even when a stale channel says otherwise', () => {
    expect(
      terminalConnectionOf({
        pod: pod(EPodState.Parked),
        connection: view(EConnectionView.Connected),
      }),
    ).toBe(ETerminalConnection.Paused)
  })

  test('maps channel states', () => {
    const map = (state: EConnectionView) =>
      terminalConnectionOf({
        pod: pod(EPodState.Running),
        connection: view(state),
      })
    expect(map(EConnectionView.Connected)).toBe(ETerminalConnection.Connected)
    expect(map(EConnectionView.Parked)).toBe(ETerminalConnection.Paused)
    expect(map(EConnectionView.Waking)).toBe(ETerminalConnection.Connecting)
    expect(map(EConnectionView.Reconnecting)).toBe(ETerminalConnection.Connecting)
    expect(map(EConnectionView.Updating)).toBe(ETerminalConnection.Connecting)
    expect(map(EConnectionView.Disconnected)).toBe(ETerminalConnection.Disconnected)
  })

  test('without a channel a booting or unknown pod reads connecting and a failed one disconnected', () => {
    expect(terminalConnectionOf({ pod: pod(EPodState.Booting), connection: null })).toBe(
      ETerminalConnection.Connecting,
    )
    expect(terminalConnectionOf({ pod: null, connection: null })).toBe(
      ETerminalConnection.Connecting,
    )
    expect(terminalConnectionOf({ pod: pod(EPodState.Failed), connection: null })).toBe(
      ETerminalConnection.Disconnected,
    )
  })
})

describe('podDetailOf', () => {
  test('formats vCPUs and memory', () => {
    const resources = {
      sandboxId: 's',
      region: 'iad1',
      vcpus: 4,
      memoryMb: 8192,
    }
    expect(podDetailOf(pod(EPodState.Running, resources))).toBe('4 vCPU · 8 GB')
    expect(podDetailOf(pod(EPodState.Running, { ...resources, memoryMb: undefined }))).toBe(
      '4 vCPU',
    )
    expect(podDetailOf(pod(EPodState.Running))).toBeUndefined()
    expect(podDetailOf(null)).toBeUndefined()
  })
})
