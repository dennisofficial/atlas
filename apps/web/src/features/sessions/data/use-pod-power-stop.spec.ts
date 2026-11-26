import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'

import { EPodPowerPhase } from '@dltech/atlas-core'

import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'

import {
  mountPodPower,
  SLEEPING,
  settlePromises,
  turnRunning,
  wait,
  WOKEN,
} from './__tests__/use-pod-power-fixture'
import { POD_SLEEP_FAILURE, podPowerSettled } from './use-pod-power'

describe('podPowerSettled with a server power phase', () => {
  it('hands a stop to the server once it reports stopping, asleep or failed', () => {
    for (const power of [EPodPowerPhase.Stopping, EPodPowerPhase.Asleep, EPodPowerPhase.Failed]) {
      expect(podPowerSettled({ state: { phase: 'sleeping' }, declared: undefined, power })).toEqual(
        { phase: 'awake' },
      )
    }
  })

  it('keeps the stop in flight while the server still reports a steady pod', () => {
    expect(
      podPowerSettled({
        state: { phase: 'sleeping' },
        declared: undefined,
        power: EPodPowerPhase.Steady,
      }),
    ).toEqual({ phase: 'sleeping' })
  })

  it('hands a wake to the server once it reports the pod starting', () => {
    expect(
      podPowerSettled({
        state: { phase: 'waking' },
        declared: undefined,
        power: EPodPowerPhase.Starting,
      }),
    ).toEqual({ phase: 'awake' })
    expect(
      podPowerSettled({
        state: { phase: 'waking' },
        declared: undefined,
        power: EPodPowerPhase.Asleep,
      }),
    ).toEqual({ phase: 'waking' })
  })
})

beforeAll(() => {
  registerDom()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})

afterAll(async () => {
  await unregisterDom()
})

describe('usePodPower stop', () => {
  it('shows the stop in flight at once and hands it to the server', async () => {
    const sleep = mock(() => Promise.resolve(SLEEPING))
    const view = await mountPodPower({ wake: mock(() => Promise.resolve(WOKEN)), sleep })
    await act(async () => view.power().sleep())
    expect(view.power().state).toEqual({ phase: 'sleeping' })
    await settlePromises()
    await view.render(undefined, EPodPowerPhase.Stopping)
    expect(view.power().state).toEqual({ phase: 'awake' })
    expect(view.power().message).toBeUndefined()
    await view.unmount()
  })

  it('keeps the stop in flight while the server has not recorded it', async () => {
    const sleep = mock(() => Promise.resolve(SLEEPING))
    const view = await mountPodPower({ wake: mock(() => Promise.resolve(WOKEN)), sleep })
    await act(async () => view.power().sleep())
    await settlePromises()
    await view.render('running', EPodPowerPhase.Steady)
    expect(view.power().state).toEqual({ phase: 'sleeping' })
    await view.unmount()
  })

  it('gives up on the stop once the deadline passes', async () => {
    const sleep = mock(() => Promise.resolve(SLEEPING))
    const view = await mountPodPower({
      wake: mock(() => Promise.resolve(WOKEN)),
      sleep,
      sleepDeadlineMs: 10,
    })
    await act(async () => view.power().sleep())
    expect(view.power().state).toEqual({ phase: 'sleeping' })
    await wait(50)
    expect(view.power().state).toEqual({ phase: 'awake' })
    expect(view.power().message).toBe(POD_SLEEP_FAILURE)
    await view.unmount()
  })

  it('drops the stop deadline once the server reports the pod asleep', async () => {
    const sleep = mock(() => Promise.resolve(SLEEPING))
    const view = await mountPodPower({
      wake: mock(() => Promise.resolve(WOKEN)),
      sleep,
      sleepDeadlineMs: 50,
    })
    await act(async () => view.power().sleep())
    await settlePromises()
    await view.render(undefined, EPodPowerPhase.Asleep)
    await wait(90)
    expect(view.power().state).toEqual({ phase: 'awake' })
    expect(view.power().message).toBeUndefined()
    await view.unmount()
  })

  it('asks for a confirmation when the pod refuses to sleep mid-turn', async () => {
    const sleep = mock(() => Promise.reject(turnRunning()))
    const view = await mountPodPower({ wake: mock(() => Promise.resolve(WOKEN)), sleep })
    await act(async () => view.power().sleep())
    await settlePromises()
    expect(view.power().state).toEqual({ phase: 'confirm' })
    await view.unmount()
  })
})
