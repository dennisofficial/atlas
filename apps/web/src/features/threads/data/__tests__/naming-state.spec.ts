import { describe, expect, it } from 'bun:test'

import { EPodState, type PodStatus } from '@dltech/atlas-wire/web'

import { namingStateOf } from '../naming-state'

const pod = (state: EPodState): PodStatus => ({ state, steps: [] })

describe('namingStateOf', () => {
  it('prefers the live title over the stored one', () => {
    expect(
      namingStateOf({
        storedTitle: 'old',
        liveTitle: 'new',
        titling: true,
        pod: pod(EPodState.Running),
      }),
    ).toEqual({ title: 'new', naming: false })
  })

  it('falls back to the stored title and never names a titled thread', () => {
    expect(
      namingStateOf({ storedTitle: 'kept', liveTitle: null, titling: false, pod: null }),
    ).toEqual({ title: 'kept', naming: false })
  })

  it('names an untitled thread while the pod has not reported', () => {
    expect(
      namingStateOf({ storedTitle: null, liveTitle: null, titling: false, pod: null }).naming,
    ).toBe(true)
  })

  it('names an untitled thread while the pod is booting', () => {
    expect(
      namingStateOf({
        storedTitle: null,
        liveTitle: null,
        titling: false,
        pod: pod(EPodState.Booting),
      }).naming,
    ).toBe(true)
  })

  it('names an untitled running thread only while titling', () => {
    const running = pod(EPodState.Running)
    expect(
      namingStateOf({ storedTitle: null, liveTitle: null, titling: true, pod: running }).naming,
    ).toBe(true)
    expect(
      namingStateOf({ storedTitle: null, liveTitle: null, titling: false, pod: running }).naming,
    ).toBe(false)
  })

  it.each([EPodState.None, EPodState.Parked, EPodState.Failed])(
    'does not treat a %s pod as starting',
    (state) => {
      expect(
        namingStateOf({ storedTitle: null, liveTitle: null, titling: false, pod: pod(state) })
          .naming,
      ).toBe(false)
    },
  )
})
