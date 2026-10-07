import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
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

import { createUserSettingsApplier } from '../apply-user-settings'
import { createFrameBuffer } from '../frame-buffer'
import { EServeEvent, type ServeLogLine } from '../serve-log'
import { createSessionHandlers, type SessionHandlers, type SessionSocket } from '../socket-session'
import type { ServeTurnDriver } from '../turn-driver'

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
    pause: touch('pause'),
    beginRelocation: touch('beginRelocation'),
    relocationResumable: () => false,
    resume: touch('resume'),
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

const attachedSocket = (): { socket: SessionSocket; sent: string[]; closed: () => boolean } => {
  const sent: string[] = []
  let closed = false
  const socket = {
    data: { helloed: true, alias: null, greeting: 0, greeted: true, held: [] },
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

const rig = (): {
  service: SettingsService
  file: string
  handlers: SessionHandlers
  socket: SessionSocket
  sent: string[]
  touched: string[]
  logged: ServeLogLine[]
  closed: () => boolean
  deliver: (content: string) => void
} => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-serve-settings-'))
  homes.push(home)
  const file = join(home, 'settings.json')
  const service = createSettingsService({
    definitions: ATLAS_SETTINGS,
    user: new FileSettingsStore({ file, label: 'serve' }),
  })
  const touched: string[] = []
  const logged: ServeLogLine[] = []
  const log = (line: ServeLogLine): void => {
    logged.push(line)
  }
  const handlers = createSessionHandlers({
    threadId,
    buffer: createFrameBuffer({ capacity: 16 }),
    inFlight: () => [],
    liveStepId: () => null,
    driver: untouchedDriver(touched),
    files: { list: async () => [] },
    refusal: () => null,
    log,
    applyUserSettings: createUserSettingsApplier({ settings: service, log }),
  })
  const { socket, sent, closed } = attachedSocket()
  const deliver = (content: string): void => {
    handlers.message({ socket, message: encodeFrame({ kind: EClientFrame.Settings, content }) })
  }
  return { service, file, handlers, socket, sent, touched, logged, closed, deliver }
}

describe('settings client frame', () => {
  it('applies the document wholesale: new values land and stale keys are cleared', () => {
    const { service, file, deliver, touched } = rig()
    service.set({ id: ESettingId.SidebarWidth, value: 60 })
    service.set({ id: ESettingId.Accent, value: 'moss' })

    deliver(JSON.stringify({ [ESettingId.Accent]: 'pine', 'model.id': 'claude-opus-4-6' }))

    const onDisk = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    expect(onDisk).toEqual({ [ESettingId.Accent]: 'pine', 'model.id': 'claude-opus-4-6' })
    expect(service.snapshot().document.values[ESettingId.Accent]).toBe('pine')
    expect(ESettingId.SidebarWidth in service.snapshot().document.values).toBe(false)
    expect(touched).toEqual([])
  })

  it('a second identical frame is a no-op: no write, no publish', () => {
    const { service, deliver } = rig()
    const content = JSON.stringify({ [ESettingId.Accent]: 'pine' })

    deliver(content)
    const version = service.version()
    let publishes = 0
    service.subscribe(() => {
      publishes += 1
    })
    deliver(content)

    expect(service.version()).toBe(version)
    expect(publishes).toBe(0)
  })

  it('garbage content is dropped without throwing, replying, or closing the socket', () => {
    const { service, deliver, sent, closed, logged, touched } = rig()
    service.set({ id: ESettingId.Accent, value: 'moss' })
    const version = service.version()

    expect(() => deliver('{ not json')).not.toThrow()
    expect(() => deliver('[1, 2]')).not.toThrow()
    expect(() => deliver('"just a string"')).not.toThrow()

    expect(service.version()).toBe(version)
    expect(service.snapshot().document.values[ESettingId.Accent]).toBe('moss')
    expect(sent).toEqual([])
    expect(closed()).toBe(false)
    expect(touched).toEqual([])
    expect(logged.map((line) => line.event)).toEqual([
      EServeEvent.SettingsDropped,
      EServeEvent.SettingsDropped,
      EServeEvent.SettingsDropped,
    ])
  })

  it('is dropped quietly when the serve composed no settings service', () => {
    const handlers = createSessionHandlers({
      threadId,
      buffer: createFrameBuffer({ capacity: 16 }),
      inFlight: () => [],
      liveStepId: () => null,
      driver: untouchedDriver([]),
      files: { list: async () => [] },
      refusal: () => null,
      log: () => undefined,
    })
    const { socket, sent } = attachedSocket()

    expect(() =>
      handlers.message({ socket, message: encodeFrame({ kind: EClientFrame.Settings, content: '{}' }) }),
    ).not.toThrow()
    expect(sent).toEqual([])
  })

  it('takes the mutation path: a parking serve refuses it and leaves the settings alone', () => {
    const home = mkdtempSync(join(tmpdir(), 'atlas-serve-settings-'))
    homes.push(home)
    const service = createSettingsService({
      definitions: ATLAS_SETTINGS,
      user: new FileSettingsStore({ file: join(home, 'settings.json'), label: 'serve' }),
    })
    const log = (): void => undefined
    const handlers = createSessionHandlers({
      threadId,
      buffer: createFrameBuffer({ capacity: 16 }),
      inFlight: () => [],
      liveStepId: () => null,
      driver: untouchedDriver([]),
      files: { list: async () => [] },
      refusal: () => null,
      admissionClosed: () => true,
      log,
      applyUserSettings: createUserSettingsApplier({ settings: service, log }),
    })
    const { socket, sent } = attachedSocket()

    handlers.message({
      socket,
      message: encodeFrame({ kind: EClientFrame.Settings, content: JSON.stringify({ [ESettingId.Accent]: 'pine' }) }),
    })

    expect(service.snapshot().document.values).toEqual({})
    expect(sent).toHaveLength(1)
  })
})
