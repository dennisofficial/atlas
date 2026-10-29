import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it, spyOn } from 'bun:test'
import { act } from 'react'

import { EClientRequest } from '@dltech/atlas-client/channel'
import { EServiceStatus } from '@dltech/atlas-wire/web'

import { EProcessKind, SHELL_READ_GAP_MS } from '../processes-model'
import {
  THREAD,
  fakeChannel,
  gate,
  mount,
  rosterOf,
  service,
  settle,
  shell,
  unmountAll,
} from './processes-fixture'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(unmountAll)

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

describe('useProcesses log reads', () => {
  it('reads the selected shell with characters 64000 and re-reads only when totalCharacters grows', async () => {
    const fake = fakeChannel(() => ({ ok: true, text: 'listening on :3000' }))
    const data = await mount(fake.channel)
    await fake.push(rosterOf({ shells: [shell()] }))
    await act(async () => data().handleSelect({ kind: EProcessKind.Shell, id: 'shell_1' }))
    await settle()
    expect(fake.callsOf(EClientRequest.ReadShellOutput)).toEqual([
      {
        op: EClientRequest.ReadShellOutput,
        params: { threadId: THREAD, shellId: 'shell_1', characters: 64_000 },
      },
    ])
    expect(data().log).toBe('listening on :3000')
    await fake.push(rosterOf({ shells: [shell()] }))
    await act(async () => Bun.sleep(SHELL_READ_GAP_MS + 50))
    expect(fake.callsOf(EClientRequest.ReadShellOutput)).toHaveLength(1)
    await fake.push(rosterOf({ shells: [shell({ totalCharacters: 40 })] }))
    await act(async () => Bun.sleep(SHELL_READ_GAP_MS + 50))
    expect(fake.callsOf(EClientRequest.ReadShellOutput)).toHaveLength(2)
  })

  it('keeps one shell read in flight while the shell prints and keeps its text', async () => {
    const reads = gate()
    const fake = fakeChannel(reads.hold)
    const data = await mount(fake.channel)
    await fake.push(rosterOf({ shells: [shell()] }))
    await act(async () => data().handleSelect({ kind: EProcessKind.Shell, id: 'shell_1' }))
    for (const total of [20, 30, 40, 50]) {
      await fake.push(rosterOf({ shells: [shell({ totalCharacters: total })] }))
    }
    expect(fake.callsOf(EClientRequest.ReadShellOutput)).toHaveLength(1)
    await reads.release({ ok: true, text: 'first' })
    expect(data().log).toBe('first')
    await act(async () => Bun.sleep(SHELL_READ_GAP_MS + 50))
    expect(fake.callsOf(EClientRequest.ReadShellOutput)).toHaveLength(2)
    await reads.release({ ok: true, text: 'second' })
    expect(data().log).toBe('second')
  })

  it('a refused shell read leaves no log text', async () => {
    const fake = fakeChannel(() => ({ ok: false, reason: 'gone' }))
    const data = await mount(fake.channel)
    await fake.push(rosterOf({ shells: [shell()] }))
    await act(async () => data().handleSelect({ kind: EProcessKind.Shell, id: 'shell_1' }))
    await settle()
    expect(data().log).toBeNull()
  })

  it('reads the selected service log with characters 64000 and keeps an empty text empty', async () => {
    const fake = fakeChannel(() => ({ text: '' }))
    const data = await mount(fake.channel)
    await fake.push(rosterOf({ services: [service()] }))
    await act(async () => data().handleSelect({ kind: EProcessKind.Service, id: 'svc_1' }))
    await settle()
    expect(fake.callsOf(EClientRequest.ReadServiceLog)).toEqual([
      { op: EClientRequest.ReadServiceLog, params: { serviceId: 'svc_1', characters: 64_000 } },
    ])
    expect(data().log).toBe('')
  })

  it('polls an expanded service every 5 s and stops when it collapses', async () => {
    const started = spyOn(globalThis, 'setInterval')
    const cleared = spyOn(globalThis, 'clearInterval')
    try {
      const fake = fakeChannel(() => ({ text: 'ready' }))
      const data = await mount(fake.channel)
      await fake.push(rosterOf({ services: [service()] }))
      await act(async () => data().handleSelect({ kind: EProcessKind.Service, id: 'svc_1' }))
      const polls = started.mock.calls.filter(([, ms]) => ms === 5_000)
      expect(polls).toHaveLength(1)
      const handle = started.mock.results[started.mock.calls.indexOf(polls[0] ?? [])]?.value
      await act(async () => data().handleSelect(null))
      expect(cleared.mock.calls.some(([id]) => id === handle)).toBe(true)
    } finally {
      started.mockRestore()
      cleared.mockRestore()
    }
  })

  it('reads an ended service log once and never polls it', async () => {
    const started = spyOn(globalThis, 'setInterval')
    try {
      const fake = fakeChannel(() => ({ text: 'bye' }))
      const data = await mount(fake.channel)
      const ended = service({ status: EServiceStatus.Exited, exitCode: 0 })
      await fake.push(rosterOf({ services: [ended] }))
      await act(async () => data().handleSelect({ kind: EProcessKind.Service, id: 'svc_1' }))
      await settle()
      expect(fake.callsOf(EClientRequest.ReadServiceLog)).toHaveLength(1)
      expect(started.mock.calls.filter(([, ms]) => ms === 5_000)).toHaveLength(0)
      expect(data().log).toBe('bye')
    } finally {
      started.mockRestore()
    }
  })

  it('stops polling once a pushed roster shows the service ended', async () => {
    const cleared = spyOn(globalThis, 'clearInterval')
    try {
      const fake = fakeChannel(() => ({ text: 'up' }))
      const data = await mount(fake.channel)
      await fake.push(rosterOf({ services: [service()] }))
      await act(async () => data().handleSelect({ kind: EProcessKind.Service, id: 'svc_1' }))
      const before = cleared.mock.calls.length
      await fake.push(rosterOf({ services: [service({ status: EServiceStatus.Killed })] }))
      expect(cleared.mock.calls.length).toBeGreaterThan(before)
    } finally {
      cleared.mockRestore()
    }
  })

  it('skips a poll tick while the previous service read is unanswered', async () => {
    const started = spyOn(globalThis, 'setInterval')
    try {
      const reads = gate()
      const fake = fakeChannel(reads.hold)
      const data = await mount(fake.channel)
      await fake.push(rosterOf({ services: [service()] }))
      await act(async () => data().handleSelect({ kind: EProcessKind.Service, id: 'svc_1' }))
      const poll = started.mock.calls.find(([, ms]) => ms === 5_000)?.[0]
      if (typeof poll !== 'function') throw new Error('expected a 5 s poll')
      await act(async () => poll())
      await act(async () => poll())
      expect(fake.callsOf(EClientRequest.ReadServiceLog)).toHaveLength(1)
      await reads.release({ text: 'first' })
      expect(data().log).toBe('first')
      await act(async () => poll())
      expect(fake.callsOf(EClientRequest.ReadServiceLog)).toHaveLength(2)
    } finally {
      started.mockRestore()
    }
  })
})
