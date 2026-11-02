import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'
import { ATLAS_SETTINGS, ESettingId, toThreadId } from '@dltech/atlas-core'
import {
  EClientFrame,
  FileSettingsStore,
  createSettingsService,
  encodeFrame,
  type SettingsService,
} from '@dltech/atlas-harness'

import type { ServeApp } from '../serve-app'
import { handlerOptionsOf } from '../serve-handler-options'
import { createFrameBuffer } from '../frame-buffer'
import { EServeEvent, type ServeLogLine } from '../serve-log'
import { createSessionHandlers, type SessionHandlers, type SessionSocket } from '../socket-session'
import type { ServeTurnDriver } from '../turn-driver'
import { refusedFile } from './fakes'

const threadId = toThreadId('thread-settings-frame')

const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0, homes.length)) rmSync(home, { recursive: true, force: true })
})

const untouchedDriver = (touched: string[]): ServeTurnDriver => {
  const touch = (name: string) => (): never => {
    touched.push(name)
    throw new Error(`the settings frame reached driver.${name}`)
  }
  return {
    say: touch('say'),
    run: touch('run'),
    sayOrRun: touch('sayOrRun'),
    interrupt: touch('interrupt'),
    dismissFailure: () => touch('dismissFailure')(),
    pause: touch('pause'),
    beginRelocation: touch('beginRelocation'),
    relocationResumable: () => false,
    resume: touch('resume'),
    outcome: () => null,
    failure: () => null,
    running: () => false,
    busy: () => false,
    outcomePending: () => false,
    settled: async () => undefined,
    attach: touch('attach'),
    holdHistory: touch('holdHistory'),
    beginRotation: touch('beginRotation'),
    holdForRotation: touch('holdForRotation'),
  }
}

const attachedSocket = (): {
  socket: SessionSocket
  sent: string[]
  closed: () => boolean
} => {
  const sent: string[] = []
  let closed = false
  const socket = {
    data: {
      helloed: true,
      alias: null,
      greeting: 0,
      greeted: true,
      held: [],
      bootHeld: [],
    },
    send: (payload: string) => {
      sent.push(payload)
    },
    close: () => {
      closed = true
    },
    terminate: () => {
      closed = true
    },
  } as unknown as SessionSocket
  return { socket, sent, closed: () => closed }
}

const rig = () => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-serve-settings-'))
  homes.push(home)
  const service = createSettingsService({
    definitions: ATLAS_SETTINGS,
    user: new FileSettingsStore({
      file: join(home, 'settings.json'),
      label: 'serve',
    }),
  })
  const touched: string[] = []
  const logged: ServeLogLine[] = []
  const log = (line: ServeLogLine): void => {
    logged.push(line)
  }
  const options = handlerOptionsOf({
    app: { settings: service, rotation: undefined } as unknown as ServeApp,
    log,
    persist: {
      env: {},
      threadId,
      controlPlaneUrl: 'http://cloud.test',
      token: 't',
      clientVersion: '0.0.0-test',
      notice: { notify: () => undefined } as unknown as Parameters<
        typeof handlerOptionsOf
      >[0]['persist']['notice'],
    },
  })
  const handlers = createSessionHandlers({
    activity: {
      read: async () => {
        throw new Error('activity is not initialized')
      },
    },
    threadId,
    buffer: createFrameBuffer({ capacity: 16 }),
    inFlight: () => [],
    liveStepId: () => null,
    driver: untouchedDriver(touched),
    files: { list: async () => [], read: async () => refusedFile },
    refusal: () => null,
    log,
    ...options,
  })
  const { socket, sent, closed } = attachedSocket()
  const deliver = (content: string): void => {
    handlers.message({
      socket,
      message: encodeFrame({ kind: EClientFrame.Settings, content }),
    })
  }
  return { service, sent, touched, logged, closed, deliver }
}

describe('settings client frame', () => {
  it('never replaces the pod settings: the frame is dropped and logged', () => {
    const { service, deliver, touched, sent, closed, logged } = rig()
    service.set({ id: ESettingId.Accent, value: 'moss' })
    const version = service.version()

    deliver(
      JSON.stringify({
        [ESettingId.Accent]: 'pine',
        'model.id': 'claude-opus-4-6',
      }),
    )

    expect(service.version()).toBe(version)
    expect(service.snapshot().document.values).toEqual({
      [ESettingId.Accent]: 'moss',
    })
    expect(touched).toEqual([])
    expect(sent).toEqual([])
    expect(closed()).toBe(false)
    expect(logged.map((line) => line.event)).toEqual([EServeEvent.SettingsDropped])
  })

  it('garbage content is dropped the same way without throwing', () => {
    const { deliver, logged } = rig()

    expect(() => deliver('{ not json')).not.toThrow()
    expect(logged.map((line) => line.event)).toEqual([EServeEvent.SettingsDropped])
  })
})
