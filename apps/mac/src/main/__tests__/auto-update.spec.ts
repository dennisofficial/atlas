import { describe, expect, test } from 'bun:test'
import {
  checkAndDownload,
  checkNow,
  EManualCheckOutcome,
  RESTART_FAILED_MESSAGE,
  RESTART_GRACE_MS,
  restartToPrepared,
  runUpdateCycle,
  type IUpdaterPort,
} from '../auto-update'
import { EDesktopUpdateState } from '../../host/update-routes'
import { createUpdateState } from '../update-state'

function fakeUpdater({
  available,
  error = '',
  applyError = '',
}: {
  available: boolean
  error?: string
  applyError?: string
}) {
  const calls: string[] = []
  let infoError = ''
  const updater: IUpdaterPort = {
    checkForUpdate: async () => {
      calls.push('check')
      return { updateAvailable: available, error }
    },
    downloadUpdate: async () => void calls.push('download'),
    updateInfo: () => ({ updateReady: true, version: '2.0.0', error: infoError }),
    applyUpdate: async () => {
      calls.push('apply')
      infoError = applyError
    },
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
      updateInfo: () => ({ updateReady: true, version: '2.0.1', error: '' }),
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
  test('restart applies the prepared update without rechecking', async () => {
    const state = createUpdateState()
    state.markReady({ version: '1.9.0' })
    const { updater, calls } = fakeUpdater({ available: true })
    const scheduled: number[] = []
    await restartToPrepared({ updater, state, schedule: ({ ms }) => void scheduled.push(ms) })
    expect(calls).toEqual(['apply'])
    expect(state.status()).toEqual({ state: EDesktopUpdateState.Restarting, version: '1.9.0' })
    expect(scheduled).toEqual([RESTART_GRACE_MS])
  })
  test('restart reports the error applyUpdate records instead of hanging', async () => {
    const state = createUpdateState()
    state.markReady({ version: '1.9.0' })
    const { updater } = fakeUpdater({ available: true, applyError: 'Cannot apply update: gone' })
    await restartToPrepared({ updater, state, schedule: () => undefined })
    expect(state.status()).toEqual({
      state: EDesktopUpdateState.Ready,
      version: '1.9.0',
      error: 'Cannot apply update: gone',
    })
  })
  test('restart reports a thrown apply failure', async () => {
    const state = createUpdateState()
    state.markReady({ version: '1.9.0' })
    const updater: IUpdaterPort = {
      ...fakeUpdater({ available: true }).updater,
      applyUpdate: async () => {
        throw new Error('helper missing')
      },
    }
    await restartToPrepared({ updater, state, schedule: () => undefined })
    expect(state.status().error).toBe('helper missing')
  })
  test('restart fails once the app is still running after the grace period', async () => {
    const state = createUpdateState()
    state.markReady({ version: '1.9.0' })
    const { updater } = fakeUpdater({ available: true })
    let fallback: (() => void) | undefined
    await restartToPrepared({ updater, state, schedule: ({ run }) => void (fallback = run) })
    fallback?.()
    expect(state.status()).toEqual({
      state: EDesktopUpdateState.Ready,
      version: '1.9.0',
      error: RESTART_FAILED_MESSAGE,
    })
  })
  test('a background cycle does not clobber a restart in flight', () => {
    const state = createUpdateState()
    state.markReady({ version: '1.9.0' })
    state.markRestarting()
    state.markReady({ version: '2.0.0' })
    expect(state.status()).toEqual({ state: EDesktopUpdateState.Restarting, version: '1.9.0' })
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
