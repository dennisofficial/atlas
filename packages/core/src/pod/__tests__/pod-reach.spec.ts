import { describe, expect, it } from 'bun:test'

import { EPodReachStep, podReachStepOf, type PodReachFacts } from '../pod-reach'

const factsOf = (overrides: Partial<PodReachFacts>): PodReachFacts => ({
  runtimeOpen: false,
  holdsLocally: false,
  selfHostId: 1,
  holderHostId: null,
  holderLive: false,
  wantsHolder: false,
  ...overrides,
})

describe('podReachStepOf', () => {
  it('serves the call here when this host has the runtime open', () => {
    expect(podReachStepOf(factsOf({ runtimeOpen: true }))).toBe(EPodReachStep.Local)
  })

  it('waits for the local runtime when this host holds the session', () => {
    expect(podReachStepOf(factsOf({ holdsLocally: true }))).toBe(EPodReachStep.AwaitLocal)
  })

  it('waits for the local runtime when this host is the live holder', () => {
    expect(
      podReachStepOf(factsOf({ holderHostId: 1, holderLive: true, holdsLocally: false })),
    ).toBe(EPodReachStep.AwaitLocal)
  })

  it('forwards to the other live holder host', () => {
    expect(podReachStepOf(factsOf({ holderHostId: 2, holderLive: true }))).toBe(
      EPodReachStep.Forward,
    )
  })

  it('wakes a session the plane already wants when no host holds it', () => {
    expect(podReachStepOf(factsOf({ wantsHolder: true }))).toBe(EPodReachStep.Wake)
  })

  it('revokes a session nobody wants when no host holds it', () => {
    expect(podReachStepOf(factsOf({}))).toBe(EPodReachStep.Revoke)
  })

  it('does not forward to a holder that is not live', () => {
    expect(podReachStepOf(factsOf({ holderHostId: 2, holderLive: false, wantsHolder: true }))).toBe(
      EPodReachStep.Wake,
    )
  })

  it('forwards to a live holder even while the session wants a holder', () => {
    expect(podReachStepOf(factsOf({ holderHostId: 2, holderLive: true, wantsHolder: true }))).toBe(
      EPodReachStep.Forward,
    )
  })

  it('does not treat an unknown host id as the live holder', () => {
    expect(
      podReachStepOf(factsOf({ selfHostId: undefined, holderHostId: 2, holderLive: true })),
    ).toBe(EPodReachStep.Forward)
  })
})
