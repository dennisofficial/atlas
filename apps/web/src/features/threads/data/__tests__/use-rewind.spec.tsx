import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, expect, it, mock } from 'bun:test'
import { act } from 'react'

import type { LivePrepareRewind } from '../live-thread-view'

import {
  destructive,
  emptyRoster,
  fullCuts,
  plain,
  point,
  rewindRig,
  runningRoster,
  wireEvents,
} from './use-rewind-fixture'

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

it('prepares parked local rewind and applies over live actions without waiting for a render', async () => {
  const prepareRewind = mock(async () => ({ events: plain, working: false, roster: emptyRoster }))
  const rig = rewindRig({ prepareRewind, situation: { working: true } })
  mounted.push(rig)
  await rig.mount()
  await act(async () => rig.data().handlePick(point))
  expect(prepareRewind).toHaveBeenCalledTimes(1)
  expect(rig.applyRewind).toHaveBeenCalledWith({ cuts: [], toSeq: 1 })
  expect(rig.rewind).not.toHaveBeenCalled()
  expect(rig.readRoster).not.toHaveBeenCalled()
  expect(rig.onRestore).toHaveBeenCalledWith('three')
  expect(rig.data().applying).toBe(false)
})

it('plans all cuts from fresh events and reprepares before confirmed local live apply', async () => {
  const prepareRewind = mock(async () => ({
    events: destructive,
    working: false,
    roster: runningRoster,
  }))
  const rig = rewindRig({ prepareRewind })
  mounted.push(rig)
  await rig.mount()
  await act(async () => rig.data().handlePick(point))
  expect(rig.data().pick?.cuts).toEqual(fullCuts)
  expect(rig.data().pick?.kills).toContainEqual({ kind: 'shell', label: 'Tests', running: true })
  expect(rig.applyRewind).not.toHaveBeenCalled()
  await act(async () => rig.data().handleConfirm())
  expect(prepareRewind).toHaveBeenCalledTimes(2)
  expect(rig.applyRewind).toHaveBeenCalledWith({ cuts: fullCuts, toSeq: 1 })
  expect(rig.rewind).not.toHaveBeenCalled()
  expect(rig.onRestore).toHaveBeenCalledWith('three')
})

it('requires a second confirmation when fresh cuts change', async () => {
  let events = destructive
  const prepareRewind = mock(async () => ({ events, working: false, roster: emptyRoster }))
  const rig = rewindRig({ prepareRewind })
  mounted.push(rig)
  await rig.mount()
  await act(async () => rig.data().handlePick(point))
  const extra = wireEvents([
    { type: 'background-shell-started', shellId: 'bash_2', command: 'bun lint' },
  ]).map((event) => ({ ...event, id: 'evt_7', seq: 7 }))
  events = [...destructive, ...extra]
  await act(async () => rig.data().handleConfirm())
  const changedCuts = [...fullCuts, { kind: 'shell', shellId: 'bash_2', command: 'bun lint' }]
  expect(rig.applyRewind).not.toHaveBeenCalled()
  expect(rig.data().pick?.cuts).toEqual(changedCuts)
  expect(rig.warning).toHaveBeenCalledWith('The rewind changed — review it and confirm again')
  await act(async () => rig.data().handleConfirm())
  expect(rig.applyRewind).toHaveBeenCalledWith({ cuts: changedCuts, toSeq: 1 })
  expect(prepareRewind).toHaveBeenCalledTimes(3)
})

it('deduplicates preparing clicks and keeps the action busy until preparation finishes', async () => {
  const pending = Promise.withResolvers<Awaited<ReturnType<LivePrepareRewind>>>()
  const prepareRewind = mock(() => pending.promise)
  const rig = rewindRig({ prepareRewind })
  mounted.push(rig)
  await rig.mount()
  let first: Promise<void> | undefined
  await act(async () => {
    first = rig.data().handlePick(point)
    void rig.data().handlePick(point)
  })
  expect(prepareRewind).toHaveBeenCalledTimes(1)
  expect(rig.data().applying).toBe(true)
  await act(async () => {
    pending.resolve({ events: plain, working: false, roster: emptyRoster })
    await first
  })
  expect(rig.applyRewind).toHaveBeenCalledTimes(1)
  expect(rig.data().applying).toBe(false)
})

it('refuses confirmation when fresh preparation reports work in progress', async () => {
  let working = false
  const prepareRewind = mock(async () => ({ events: destructive, working, roster: emptyRoster }))
  const rig = rewindRig({ prepareRewind })
  mounted.push(rig)
  await rig.mount()
  await act(async () => rig.data().handlePick(point))
  working = true
  await act(async () => rig.data().handleConfirm())
  expect(rig.applyRewind).not.toHaveBeenCalled()
  expect(rig.rewind).not.toHaveBeenCalled()
  expect(rig.data().pick).toBeNull()
})

it('requires review again when the current roster changes a destructive confirmation', async () => {
  let roster = emptyRoster
  const prepareRewind = mock(async () => ({ events: destructive, working: false, roster }))
  const rig = rewindRig({ prepareRewind })
  mounted.push(rig)
  await rig.mount()
  await act(async () => rig.data().handlePick(point))
  roster = runningRoster
  await act(async () => rig.data().handleConfirm())
  expect(rig.applyRewind).not.toHaveBeenCalled()
  expect(rig.data().pick?.kills).toContainEqual({ kind: 'shell', label: 'Tests', running: true })
  await act(async () => rig.data().handleConfirm())
  expect(rig.applyRewind).toHaveBeenCalledTimes(1)
})

it('does not apply a prepared snapshot after the selected thread changes', async () => {
  const pending = Promise.withResolvers<Awaited<ReturnType<LivePrepareRewind>>>()
  const rig = rewindRig({ prepareRewind: () => pending.promise })
  mounted.push(rig)
  await rig.mount()
  let picking: Promise<void> | undefined
  await act(async () => {
    picking = rig.data().handlePick(point)
  })
  await rig.update({ threadId: 'thr_other' })
  await act(async () => {
    pending.resolve({ events: plain, working: false, roster: emptyRoster })
    await picking
  })
  expect(rig.applyRewind).not.toHaveBeenCalled()
  expect(rig.rewind).not.toHaveBeenCalled()
  expect(rig.onRestore).not.toHaveBeenCalled()
})

it('requires review again when fresh history moves the selected target', async () => {
  let events = destructive
  const prepareRewind = mock(async () => ({ events, working: false, roster: emptyRoster }))
  const rig = rewindRig({ prepareRewind })
  mounted.push(rig)
  await rig.mount()
  await act(async () => rig.data().handlePick(point))
  events = destructive.map((event) => (event.id === point.eventId ? { ...event, seq: 3 } : event))
  await act(async () => rig.data().handleConfirm())
  expect(rig.applyRewind).not.toHaveBeenCalled()
  expect(rig.data().pick?.toSeq).toBe(2)
  await act(async () => rig.data().handleConfirm())
  expect(rig.applyRewind).toHaveBeenCalledWith({ cuts: fullCuts, toSeq: 2 })
})

it('deduplicates confirmation preparation while retaining the displayed plan', async () => {
  const pending = Promise.withResolvers<Awaited<ReturnType<LivePrepareRewind>>>()
  let confirming = false
  const prepareRewind = mock(() =>
    confirming
      ? pending.promise
      : Promise.resolve({
          events: destructive,
          working: false,
          roster: emptyRoster,
        }),
  )
  const rig = rewindRig({ prepareRewind })
  mounted.push(rig)
  await rig.mount()
  await act(async () => rig.data().handlePick(point))
  confirming = true
  let first: Promise<void> | undefined
  await act(async () => {
    first = rig.data().handleConfirm()
    void rig.data().handleConfirm()
    rig.data().handleCancel()
    void rig.data().handlePick(point)
  })
  expect(prepareRewind).toHaveBeenCalledTimes(2)
  expect(rig.data().pick?.cuts).toEqual(fullCuts)
  expect(rig.data().applying).toBe(true)
  await act(async () => {
    pending.resolve({ events: destructive, working: false, roster: emptyRoster })
    await first
  })
  expect(rig.applyRewind).toHaveBeenCalledTimes(1)
})

it('requires confirmation again even if fresh history no longer has any cuts', async () => {
  let events = destructive
  const rig = rewindRig({
    prepareRewind: async () => ({ events, working: false, roster: emptyRoster }),
  })
  mounted.push(rig)
  await rig.mount()
  await act(async () => rig.data().handlePick(point))
  events = plain
  await act(async () => rig.data().handleConfirm())
  expect(rig.applyRewind).not.toHaveBeenCalled()
  expect(rig.data().pick?.cuts).toEqual([])
  await act(async () => rig.data().handleConfirm())
  expect(rig.applyRewind).toHaveBeenCalledWith({ cuts: [], toSeq: 1 })
})

it('does not carry a local destructive confirmation into a different thread', async () => {
  const prepareRewind = mock(async () => ({
    events: destructive,
    working: false,
    roster: emptyRoster,
  }))
  const rig = rewindRig({ prepareRewind })
  mounted.push(rig)
  await rig.mount()
  await act(async () => rig.data().handlePick(point))
  await rig.update({ threadId: 'thr_other' })
  await act(async () => rig.data().handleConfirm())
  expect(rig.applyRewind).not.toHaveBeenCalled()
  expect(prepareRewind).toHaveBeenCalledTimes(1)
  expect(rig.data().pick).toBeNull()
  expect(rig.warning).toHaveBeenCalledWith(
    'The selected thread changed — pick the rewind point again',
  )
})
