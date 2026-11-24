import { describe, expect, it } from 'bun:test'

import { podBusyFactsOf, podBusyOf, podResizeBusyOf, type PodBusyFacts } from '../pod/pod-busy'
import { ESessionStatus } from '../record/views/status-types'

const factsOf = (over: Partial<PodBusyFacts> = {}): PodBusyFacts => ({
  shellsRunning: 0,
  servicesRunning: 0,
  setupRunning: false,
  turnInFlight: false,
  toolRunning: false,
  agentsRunning: 0,
  ...over,
})

describe('podBusyOf', () => {
  it('is idle when nothing runs on the pod', () => {
    expect(podBusyOf(factsOf())).toEqual({ busy: false, running: [] })
  })

  it('names a running setup script', () => {
    expect(podBusyOf(factsOf({ setupRunning: true }))).toEqual({
      busy: true,
      running: ['Setup script'],
    })
  })

  it('counts the running shells and services', () => {
    expect(podBusyOf(factsOf({ shellsRunning: 2, servicesRunning: 1 })).running).toEqual([
      '2 shells',
      '1 service',
    ])
  })

  it('says one shell rather than one shells', () => {
    expect(podBusyOf(factsOf({ shellsRunning: 1 })).running).toEqual(['1 shell'])
  })

  it('counts a turn in flight as busy', () => {
    expect(podBusyOf(factsOf({ turnInFlight: true }))).toEqual({
      busy: true,
      running: ['Agent turn'],
    })
  })

  it('lists everything running in one line for the dialog', () => {
    const busy = podBusyOf(
      factsOf({ setupRunning: true, shellsRunning: 2, servicesRunning: 3, turnInFlight: true }),
    )
    expect(busy.running.join(', ')).toBe('Setup script, 2 shells, 3 services, Agent turn')
  })
})

describe('podResizeBusyOf', () => {
  it('lets a resize run under a turn that is only thinking', () => {
    expect(podResizeBusyOf(factsOf({ turnInFlight: true }))).toEqual({ busy: false, running: [] })
  })

  it('holds a resize while a tool call runs on the pod', () => {
    expect(podResizeBusyOf(factsOf({ turnInFlight: true, toolRunning: true }))).toEqual({
      busy: true,
      running: ['Tool call'],
    })
  })

  it('holds a resize while sub-agents run', () => {
    expect(podResizeBusyOf(factsOf({ agentsRunning: 2 })).running).toEqual(['2 sub-agents'])
  })

  it('holds a resize for the same processes a sleep waits for', () => {
    expect(
      podResizeBusyOf(factsOf({ setupRunning: true, shellsRunning: 1, servicesRunning: 2 }))
        .running,
    ).toEqual(['Setup script', '1 shell', '2 services'])
  })
})

describe('podBusyFactsOf', () => {
  it('reads the setup script from the preparing state', () => {
    expect(
      podBusyFactsOf({ state: ESessionStatus.Preparing, shellsRunning: 0, servicesRunning: 0 }),
    ).toEqual(factsOf({ setupRunning: true }))
  })

  it('reads a running tool only from the running-tool state', () => {
    const toolRunningIn = (state: ESessionStatus) =>
      podBusyFactsOf({ state, shellsRunning: 0, servicesRunning: 0 }).toolRunning
    expect(toolRunningIn(ESessionStatus.RunningTool)).toBe(true)
    expect(toolRunningIn(ESessionStatus.Thinking)).toBe(false)
  })

  it('reads a turn in flight from the working states', () => {
    for (const state of [
      ESessionStatus.Thinking,
      ESessionStatus.RunningTool,
      ESessionStatus.WaitingToRetry,
      ESessionStatus.Resuming,
      ESessionStatus.WaitingForBackground,
    ]) {
      expect(podBusyFactsOf({ state, shellsRunning: 0, servicesRunning: 0 }).turnInFlight).toBe(
        true,
      )
    }
  })

  it('reads an idle or failed session as no turn in flight', () => {
    for (const state of [
      ESessionStatus.Idle,
      ESessionStatus.Failed,
      ESessionStatus.SetupFailed,
      ESessionStatus.StartFailed,
      ESessionStatus.Queued,
      ESessionStatus.WaitingForCredentials,
      ESessionStatus.WaitingForOperator,
      undefined,
    ]) {
      expect(podBusyFactsOf({ state, shellsRunning: 0, servicesRunning: 0 }).turnInFlight).toBe(
        false,
      )
    }
  })

  it('carries the shell and service counts through', () => {
    expect(
      podBusyFactsOf({ state: ESessionStatus.Idle, shellsRunning: 2, servicesRunning: 1 }),
    ).toEqual(factsOf({ shellsRunning: 2, servicesRunning: 1 }))
  })
})
