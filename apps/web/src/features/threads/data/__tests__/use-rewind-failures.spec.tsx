import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, expect, it, mock, spyOn } from 'bun:test'
import { act } from 'react'
import { toast } from 'sonner'

import { EPodState } from '@dltech/atlas-wire/web'

import { destructive, emptyRoster, plain, point, rewindRig } from './use-rewind-fixture'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})
const mounted: ReturnType<typeof rewindRig>[] = []
afterEach(async () => {
  for (const rig of mounted.splice(0)) await rig.unmount()
})

it('refuses unavailable local preparation without falling back to Cloud offline rewind', async () => {
  const error = spyOn(toast, 'error')
  const rig = rewindRig()
  mounted.push(rig)
  try {
    await rig.mount()
    await act(async () => rig.data().handlePick(point))
    expect(error).toHaveBeenCalledWith('Local rewind is not available')
    expect(rig.rewind).not.toHaveBeenCalled()
    expect(rig.readRoster).not.toHaveBeenCalled()
    expect(rig.applyRewind).not.toHaveBeenCalled()
    expect(rig.data().pick).toBeNull()
  } finally {
    error.mockRestore()
  }
})

it('surfaces wake or roster preparation failure rather than planning against a null roster', async () => {
  const error = spyOn(toast, 'error')
  const prepareRewind = mock(async () => {
    throw new Error('roster unavailable')
  })
  const rig = rewindRig({ prepareRewind })
  mounted.push(rig)
  try {
    await rig.mount()
    await act(async () => rig.data().handlePick(point))
    expect(error).toHaveBeenCalledWith('roster unavailable')
    expect(rig.applyRewind).not.toHaveBeenCalled()
    expect(rig.rewind).not.toHaveBeenCalled()
    expect(rig.onRestore).not.toHaveBeenCalled()
    expect(rig.data().applying).toBe(false)
  } finally {
    error.mockRestore()
  }
})

it('keeps Cloud parked rewinds on the existing offline route without local preparation', async () => {
  const prepareRewind = mock(async () => ({ events: plain, working: false, roster: emptyRoster }))
  const rig = rewindRig({ local: false, prepareRewind })
  mounted.push(rig)
  await rig.mount()
  await act(async () => rig.data().handlePick(point))
  expect(prepareRewind).not.toHaveBeenCalled()
  expect(rig.rewind).toHaveBeenCalledWith({ threadId: 'thr_1', toSeq: 1, cutAgents: [] })
  expect(rig.applyRewind).not.toHaveBeenCalled()
  expect(rig.refreshEvents).toHaveBeenCalledTimes(1)
})

it('keeps Cloud live rewinds on the connected roster and action route', async () => {
  const prepareRewind = mock(async () => ({ events: plain, working: false, roster: emptyRoster }))
  const rig = rewindRig({
    local: false,
    prepareRewind,
    situation: { live: true, podState: EPodState.Running },
  })
  mounted.push(rig)
  await rig.mount()
  await act(async () => rig.data().handlePick(point))
  expect(prepareRewind).not.toHaveBeenCalled()
  expect(rig.readRoster).toHaveBeenCalledTimes(1)
  expect(rig.applyRewind).toHaveBeenCalledWith({ cuts: [], toSeq: 1 })
  expect(rig.rewind).not.toHaveBeenCalled()
})

it('does not apply or restore after preparation fails at confirmation', async () => {
  let unavailable = false
  const prepareRewind = mock(async () => {
    if (unavailable) throw new Error('wake failed')
    return { events: destructive, working: false, roster: emptyRoster }
  })
  const error = spyOn(toast, 'error')
  const rig = rewindRig({ prepareRewind })
  mounted.push(rig)
  try {
    await rig.mount()
    await act(async () => rig.data().handlePick(point))
    unavailable = true
    await act(async () => rig.data().handleConfirm())
    expect(error).toHaveBeenCalledWith('wake failed')
    expect(rig.applyRewind).not.toHaveBeenCalled()
    expect(rig.rewind).not.toHaveBeenCalled()
    expect(rig.onRestore).not.toHaveBeenCalled()
    expect(rig.data().applying).toBe(false)
  } finally {
    error.mockRestore()
  }
})
