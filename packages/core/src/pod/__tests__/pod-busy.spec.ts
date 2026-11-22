import { describe, expect, it } from 'bun:test'

import { ESessionStatus } from '../../record/views/status-types'
import { EPodRebootHold, podRebootSafeOf, type PodRebootFacts } from '../pod-busy'

const factsOf = (over: Partial<PodRebootFacts>): PodRebootFacts => ({
  state: undefined,
  shellsRunning: 0,
  servicesRunning: 0,
  backgroundAgents: 0,
  terminalsHeld: 0,
  peersPlaced: 0,
  ...over,
})

describe('podRebootSafeOf', () => {
  it.each([
    ESessionStatus.Thinking,
    ESessionStatus.WaitingToRetry,
    ESessionStatus.Resuming,
    ESessionStatus.WaitingForBackground,
    ESessionStatus.Queued,
    ESessionStatus.Idle,
    ESessionStatus.Failed,
    undefined,
  ])('allows a reboot of a pod whose session is %s', (state) => {
    expect(podRebootSafeOf(factsOf({ state }))).toEqual({ safe: true, holds: [] })
  })

  it('holds the reboot while the setup script runs', () => {
    expect(podRebootSafeOf(factsOf({ state: ESessionStatus.Preparing })).holds).toEqual([
      EPodRebootHold.Preparing,
    ])
  })

  it('holds the reboot while a tool call is in flight', () => {
    const safety = podRebootSafeOf(factsOf({ state: ESessionStatus.RunningTool }))
    expect(safety.safe).toBe(false)
    expect(safety.holds).toEqual([EPodRebootHold.RunningTool])
  })

  it('holds the reboot for every piece of pod work at once', () => {
    expect(
      podRebootSafeOf(
        factsOf({
          state: ESessionStatus.RunningTool,
          shellsRunning: 2,
          servicesRunning: 1,
          backgroundAgents: 1,
          terminalsHeld: 1,
          peersPlaced: 1,
        }),
      ),
    ).toEqual({
      safe: false,
      holds: [
        EPodRebootHold.RunningTool,
        EPodRebootHold.Shells,
        EPodRebootHold.Services,
        EPodRebootHold.BackgroundAgents,
        EPodRebootHold.Terminals,
        EPodRebootHold.Peers,
      ],
    })
  })

  it('holds the reboot while a shell keeps running on an idle session', () => {
    expect(
      podRebootSafeOf(factsOf({ state: ESessionStatus.Idle, shellsRunning: 1 })).holds,
    ).toEqual([EPodRebootHold.Shells])
  })

  it('holds the reboot while another session is placed on the pod', () => {
    expect(podRebootSafeOf(factsOf({ peersPlaced: 1 })).holds).toEqual([EPodRebootHold.Peers])
  })

  it('holds the reboot while a terminal is open', () => {
    expect(podRebootSafeOf(factsOf({ terminalsHeld: 1 })).holds).toEqual([EPodRebootHold.Terminals])
  })
})
