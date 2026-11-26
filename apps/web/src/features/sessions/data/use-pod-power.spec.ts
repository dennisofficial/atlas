import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'

import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { CloudApiError } from '@/lib/cloud-api'

import {
  ELSEWHERE,
  mountPodPower,
  settlePromises,
  turnRunning,
  wait,
  WOKEN,
} from './__tests__/use-pod-power-fixture'
import { isPodTurnRunning, nextPodPower, POD_WAKE_FAILURE, podPowerSettled } from './use-pod-power'

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

beforeAll(() => {
  registerDom()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})

afterAll(async () => {
  await unregisterDom()
})

describe('usePodPower wake', () => {
  it('shows the pod starting at once and clears once it reports itself running', async () => {
    const wake = mock(() => Promise.resolve(WOKEN))
    const view = await mountPodPower({ wake })
    await act(async () => view.power().wake())
    expect(view.power().state).toEqual({ phase: 'waking' })
    await settlePromises()
    expect(view.power().state).toEqual({ phase: 'waking' })
    await view.render('running')
    expect(view.power().state).toEqual({ phase: 'awake' })
    expect(view.power().message).toBeUndefined()
    await view.unmount()
  })

  it('keeps a wake in flight when a live host already holds the pod', async () => {
    const wake = mock(() => Promise.resolve(ELSEWHERE))
    const view = await mountPodPower({ wake })
    await act(async () => view.power().wake())
    await settlePromises()
    expect(view.power().state).toEqual({ phase: 'waking' })
    expect(view.power().message).toBeUndefined()
    await view.render('running')
    expect(view.power().state).toEqual({ phase: 'awake' })
    await view.unmount()
  })

  it('gives up on the wake once the deadline passes', async () => {
    const wake = mock(() => Promise.resolve(ELSEWHERE))
    const view = await mountPodPower({ wake, wakeDeadlineMs: 10 })
    await act(async () => view.power().wake())
    expect(view.power().state).toEqual({ phase: 'waking' })
    await wait(50)
    expect(view.power().state).toEqual({ phase: 'awake' })
    expect(view.power().message).toBe(POD_WAKE_FAILURE)
    await view.unmount()
  })

  it('drops the deadline once the pod reports itself running', async () => {
    const wake = mock(() => Promise.resolve(WOKEN))
    const view = await mountPodPower({ wake, wakeDeadlineMs: 50 })
    await act(async () => view.power().wake())
    await view.render('running')
    await wait(90)
    expect(view.power().state).toEqual({ phase: 'awake' })
    expect(view.power().message).toBeUndefined()
    await view.unmount()
  })

  it('shows why the wake failed', async () => {
    const wake = mock(() => Promise.reject(new Error('the pod is gone')))
    const view = await mountPodPower({ wake })
    await act(async () => view.power().wake())
    await settlePromises()
    expect(view.power().state).toEqual({ phase: 'awake' })
    expect(view.power().message).toBe('the pod is gone')
    await view.unmount()
  })
})
