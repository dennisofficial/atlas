import { describe, expect, it } from 'bun:test'

import { CloudApiError } from '@/lib/cloud-api'

import { isPodTurnRunning, nextPodPower, POD_TURN_RUNNING, podPowerSettled } from './use-pod-power'

const turnRunning = (): CloudApiError =>
  new CloudApiError({
    message: 'the pod is busy: Agent turn',
    status: 409,
    code: POD_TURN_RUNNING,
  })

describe('isPodTurnRunning', () => {
  it('reads the refusal atlas sends when the pod is working', () => {
    expect(isPodTurnRunning(turnRunning())).toBe(true)
  })

  it('ignores any other failure', () => {
    expect(isPodTurnRunning(new CloudApiError({ message: 'gone', status: 404 }))).toBe(false)
    expect(isPodTurnRunning(new Error('the pod is busy'))).toBe(false)
  })
})

describe('podPowerSettled', () => {
  it('clears the stop in flight once the pod reports itself asleep', () => {
    expect(podPowerSettled({ state: { phase: 'sleeping' }, declared: 'sleeping' })).toEqual({
      phase: 'awake',
    })
  })

  it('clears the wake in flight once the pod reports itself running', () => {
    expect(podPowerSettled({ state: { phase: 'waking' }, declared: 'running' })).toEqual({
      phase: 'awake',
    })
  })

  it('keeps a stop in flight while the pod still runs', () => {
    expect(podPowerSettled({ state: { phase: 'sleeping' }, declared: 'running' })).toEqual({
      phase: 'sleeping',
    })
  })

  it('keeps a wake in flight while the pod is still parked', () => {
    expect(podPowerSettled({ state: { phase: 'waking' }, declared: 'sleeping' })).toEqual({
      phase: 'waking',
    })
  })

  it('leaves a confirmed stop alone until the operator answers', () => {
    expect(podPowerSettled({ state: { phase: 'confirm' }, declared: 'sleeping' })).toEqual({
      phase: 'confirm',
    })
  })
})

describe('nextPodPower', () => {
  it('asks for a confirmation when the pod refused to sleep mid-turn', () => {
    expect(nextPodPower({ state: { phase: 'awake' }, event: { type: 'turn-running' } })).toEqual({
      phase: 'confirm',
    })
  })

  it('shows the pod sleeping once it agreed', () => {
    expect(nextPodPower({ state: { phase: 'confirm' }, event: { type: 'sleeping' } })).toEqual({
      phase: 'sleeping',
    })
  })

  it('shows the pod waking when the play button is pressed', () => {
    expect(nextPodPower({ state: { phase: 'sleeping' }, event: { type: 'wake' } })).toEqual({
      phase: 'waking',
    })
  })

  it('goes back to awake when the operator cancels or the call fails', () => {
    expect(nextPodPower({ state: { phase: 'confirm' }, event: { type: 'cancel' } })).toEqual({
      phase: 'awake',
    })
    expect(nextPodPower({ state: { phase: 'waking' }, event: { type: 'cancel' } })).toEqual({
      phase: 'awake',
    })
  })
})
