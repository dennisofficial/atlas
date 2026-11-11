import { describe, expect, test } from 'bun:test'

import {
  answerUpdate,
  createBinaryUpdater,
  createDesktopUpdates,
  IDLE,
  READY,
  RESTARTING,
} from '../updates.js'
import { EDesktopUpdateState, type IDesktopUpdateStatus } from '../src/host/update-routes'
import { EWebPayloadState } from '../src/host/web-payload/updater'

const fakeAutoUpdater = () => {
  const handlers = new Map<string, (value: unknown) => void>()
  let installs = 0
  return {
    autoUpdater: {
      on: (name: string, handler: (value: unknown) => void) => handlers.set(name, handler),
      checkForUpdates: async () => ({ updateInfo: undefined }),
      quitAndInstall: () => {
        installs += 1
      },
    },
    emit: (name: string, value: unknown) => handlers.get(name)?.(value),
    installs: () => installs,
  }
}

const payloadsWith = ({
  pending,
  web = { state: EWebPayloadState.Idle },
  swaps = [],
}: {
  pending?: string
  web?: IDesktopUpdateStatus['web']
  swaps?: string[]
}) => ({
  updater: { pending: () => pending, status: () => web },
  check: async () => web,
  swap: async ({ hash }: { hash: string }) => {
    swaps.push(hash)
    return true
  },
})

const binaryWith = (status: IDesktopUpdateStatus, restarts: string[] = []) => ({
  status: () => status,
  check: async () => status,
  restart: async () => void restarts.push('restart'),
})

const request = (method: string) => new Request('http://127.0.0.1/update', { method })

describe('the update states the shell reports', () => {
  test('are the ones the host route answers with', () => {
    expect(IDLE).toBe(EDesktopUpdateState.Idle)
    expect(READY).toBe(EDesktopUpdateState.Ready)
    expect(RESTARTING).toBe(EDesktopUpdateState.Restarting)
  })
})

describe('createBinaryUpdater', () => {
  test('reports ready with the version the app downloaded', async () => {
    const fake = fakeAutoUpdater()
    const binary = createBinaryUpdater({ autoUpdater: fake.autoUpdater, enabled: true })

    fake.emit('update-downloaded', { version: '1.320.0' })

    expect(binary.status()).toEqual({ state: READY, version: '1.320.0' })
  })

  test('quits and installs the download it was asked to restart for', async () => {
    const fake = fakeAutoUpdater()
    const binary = createBinaryUpdater({ autoUpdater: fake.autoUpdater, enabled: true })
    fake.emit('update-downloaded', { version: '1.320.0' })

    await binary.restart()

    expect(fake.installs()).toBe(1)
    expect(binary.status()).toEqual({ state: RESTARTING, version: '1.320.0' })
  })

  test('reports the failure instead of keeping a stale ready state', async () => {
    const fake = fakeAutoUpdater()
    const binary = createBinaryUpdater({ autoUpdater: fake.autoUpdater, enabled: true })
    fake.emit('update-downloaded', { version: '1.320.0' })

    fake.emit('error', new Error('feed unreachable'))

    expect(binary.status()).toEqual({ state: IDLE, error: 'feed unreachable' })
  })

  test('does nothing in a build that is not packaged', async () => {
    const fake = fakeAutoUpdater()
    const binary = createBinaryUpdater({ autoUpdater: fake.autoUpdater, enabled: false })

    expect(await binary.check()).toEqual({ state: IDLE })
    binary.start()
    await expect(binary.restart()).rejects.toThrow()
    expect(fake.installs()).toBe(0)
  })
})

describe('createDesktopUpdates', () => {
  test('offers a downloaded payload as an interface update', async () => {
    const updates = createDesktopUpdates({
      payloads: payloadsWith({
        pending: 'abc123',
        web: { state: EWebPayloadState.Ready, version: '1.320.0', hash: 'abc123' },
      }),
      binary: binaryWith({ state: IDLE }),
    })

    expect(await updates.status()).toEqual({
      state: IDLE,
      web: { state: EWebPayloadState.Ready, version: '1.320.0', hash: 'abc123' },
    })
  })

  test('swaps the payload the person asked for rather than the binary', async () => {
    const swaps: string[] = []
    const restarts: string[] = []
    const updates = createDesktopUpdates({
      payloads: payloadsWith({
        pending: 'abc123',
        web: { state: EWebPayloadState.Ready },
        swaps,
      }),
      binary: binaryWith({ state: READY, version: '1.320.0' }, restarts),
    })

    await updates.restart()

    expect(swaps).toEqual(['abc123'])
    expect(restarts).toEqual([])
  })

  test('restarts into a downloaded app build when no payload is waiting', async () => {
    const swaps: string[] = []
    const restarts: string[] = []
    const updates = createDesktopUpdates({
      payloads: payloadsWith({ swaps }),
      binary: binaryWith({ state: READY, version: '1.320.0' }, restarts),
    })

    await updates.restart()

    expect(swaps).toEqual([])
    expect(restarts).toEqual(['restart'])
  })

  test('refuses to restart with nothing ready', async () => {
    const updates = createDesktopUpdates({
      payloads: payloadsWith({}),
      binary: binaryWith({ state: IDLE }),
    })

    await expect(updates.restart()).rejects.toThrow()
  })
})

describe('answerUpdate', () => {
  const shellWith = ({
    status = { state: IDLE } as IDesktopUpdateStatus,
    restarts = [] as string[],
    checkThrows = false,
  } = {}) => ({
    restarts,
    updates: {
      status: async () => status,
      check: async () => {
        if (checkThrows) throw new Error('the feed answered 503')
        return status
      },
      restart: async () => {
        restarts.push('restart')
      },
    },
  })

  test('answers the status the shell holds', async () => {
    const { updates } = shellWith({ status: { state: READY, version: '1.320.0' } })

    expect(
      await answerUpdate({ updates, request: request('GET'), pathname: '/update/status' }),
    ).toEqual({ status: 200, body: { state: READY, version: '1.320.0' } })
  })

  test('reports a failed check as an idle status carrying the reason', async () => {
    const { updates } = shellWith({ checkThrows: true })

    expect(
      await answerUpdate({ updates, request: request('POST'), pathname: '/update/check' }),
    ).toEqual({ status: 200, body: { state: IDLE, error: 'the feed answered 503' } })
  })

  test('refuses a restart while nothing is ready', async () => {
    const { updates, restarts } = shellWith()

    expect(
      await answerUpdate({ updates, request: request('POST'), pathname: '/update/restart' }),
    ).toEqual({ status: 409, body: { message: 'No update is ready' } })
    expect(restarts).toEqual([])
  })

  test('takes a restart once an interface payload is ready', async () => {
    const { updates, restarts } = shellWith({
      status: { state: IDLE, web: { state: EWebPayloadState.Ready, hash: 'abc123' } },
    })

    expect(
      await answerUpdate({ updates, request: request('POST'), pathname: '/update/restart' }),
    ).toEqual({ status: 202, body: null })
    await Promise.resolve()
    expect(restarts).toEqual(['restart'])
  })

  test('leaves the pane routes alone', () => {
    const { updates } = shellWith()

    expect(answerUpdate({ updates, request: request('POST'), pathname: '/pane' })).toBeUndefined()
    expect(
      answerUpdate({ updates, request: request('POST'), pathname: '/desktop/pane' }),
    ).toBeUndefined()
  })
})
