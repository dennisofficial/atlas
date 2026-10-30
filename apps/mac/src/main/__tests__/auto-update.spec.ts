import { describe, expect, test } from 'bun:test'
import {
  checkAndDownload,
  checkNow,
  EManualCheckOutcome,
  restartToLatest,
  runUpdateCycle,
  type IUpdaterPort,
} from '../auto-update'
import { EDesktopUpdateState } from '../../host/update-routes'
import { createUpdateState } from '../update-state'

function fakeUpdater({ available, error = '' }: { available: boolean; error?: string }) {
  const calls: string[] = []
  const updater: IUpdaterPort = {
    checkForUpdate: async () => {
      calls.push('check')
      return { updateAvailable: available, error }
    },
    downloadUpdate: async () => void calls.push('download'),
    updateInfo: () => ({ updateReady: true, version: '2.0.0' }),
    applyUpdate: async () => void calls.push('apply'),
  }
  return { updater, calls }
}

describe('auto-update', () => {
  test('does not download when current', async () => {
    const { updater, calls } = fakeUpdater({ available: false })
    expect(await checkAndDownload({ updater })).toBe(false)
    expect(calls).toEqual(['check'])
  })
  test('records ready with the downloaded version instead of prompting', async () => {
    const state = createUpdateState()
    const { updater } = fakeUpdater({ available: false })
    await runUpdateCycle({ updater, onReady: state.markReady })
    expect(state.status()).toEqual({ state: EDesktopUpdateState.Idle })
    const ready = fakeUpdater({ available: true })
    await runUpdateCycle({ updater: ready.updater, onReady: state.markReady })
    expect(state.status()).toEqual({ state: EDesktopUpdateState.Ready, version: '2.0.0' })
  })
  test('a newer release replaces the one already ready', async () => {
    const state = createUpdateState()
    const first = fakeUpdater({ available: true })
    await runUpdateCycle({ updater: first.updater, onReady: state.markReady })
    const newer: IUpdaterPort = {
      ...first.updater,
      updateInfo: () => ({ updateReady: true, version: '2.0.1' }),
    }
    await runUpdateCycle({ updater: newer, onReady: state.markReady })
    expect(state.status()).toEqual({ state: EDesktopUpdateState.Ready, version: '2.0.1' })
  })
  test('check now reports current, ready, and failed', async () => {
    const state = createUpdateState()
    const current = fakeUpdater({ available: false })
    expect(await checkNow({ updater: current.updater, onReady: state.markReady })).toEqual({
      outcome: EManualCheckOutcome.Current,
    })
    const failing = fakeUpdater({ available: true, error: 'HTTP 404' })
    expect(await checkNow({ updater: failing.updater, onReady: state.markReady })).toEqual({
      outcome: EManualCheckOutcome.Failed,
      message: 'HTTP 404',
    })
    expect(state.status()).toEqual({ state: EDesktopUpdateState.Idle })
    const ready = fakeUpdater({ available: true })
    expect(await checkNow({ updater: ready.updater, onReady: state.markReady })).toEqual({
      outcome: EManualCheckOutcome.Ready,
      version: '2.0.0',
    })
    expect(state.status()).toEqual({ state: EDesktopUpdateState.Ready, version: '2.0.0' })
  })
  test('restart downloads a release newer than the ready one before applying', async () => {
    const state = createUpdateState()
    state.markReady({ version: '1.9.0' })
    const { updater, calls } = fakeUpdater({ available: true })
    await restartToLatest({ updater, onReady: state.markReady })
    expect(calls).toEqual(['check', 'download', 'apply'])
    expect(state.status()).toEqual({ state: EDesktopUpdateState.Ready, version: '2.0.0' })
  })
  test('restart still applies the ready update when the recheck fails', async () => {
    const state = createUpdateState()
    state.markReady({ version: '1.9.0' })
    const { updater, calls } = fakeUpdater({ available: true, error: 'offline' })
    await restartToLatest({ updater, onReady: state.markReady })
    expect(calls).toEqual(['check', 'apply'])
    expect(state.status()).toEqual({ state: EDesktopUpdateState.Ready, version: '1.9.0' })
  })
  test('omits an empty version', () => {
    const state = createUpdateState()
    state.markReady({ version: '' })
    expect(state.status()).toEqual({ state: EDesktopUpdateState.Ready })
  })
  test('swallows updater errors and stays idle', async () => {
    const state = createUpdateState()
    const { updater } = fakeUpdater({ available: true, error: 'HTTP 404' })
    await runUpdateCycle({ updater, onReady: state.markReady })
    expect(state.status()).toEqual({ state: EDesktopUpdateState.Idle })
  })
})
