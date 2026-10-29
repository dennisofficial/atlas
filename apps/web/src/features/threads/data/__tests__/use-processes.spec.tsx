import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { EClientRequest, RemoteRequestLost } from '@dltech/atlas-client/channel'
import { EShellStatus } from '@dltech/atlas-wire/web'

import { EProcessKind } from '../processes-model'
import {
  THREAD,
  fakeChannel,
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

describe('useProcesses actions', () => {
  it('lists the shells of this thread and every service off the roster push', async () => {
    const fake = fakeChannel(() => null)
    const data = await mount(fake.channel)
    await fake.push(
      rosterOf({
        shells: [shell(), shell({ shellId: 'shell_2', threadId: 'thr_child' })],
        services: [service()],
      }),
    )
    expect(data().shells.map((entry) => entry.shellId)).toEqual(['shell_1'])
    expect(data().services.map((entry) => entry.serviceId)).toEqual(['svc_1'])
  })

  it('handleKill sends kill-shell with threadId and shellId and keeps the row busy until a push shows it settled', async () => {
    const fake = fakeChannel(() => ({ ok: true, snapshot: shell({ status: EShellStatus.Killed }) }))
    const data = await mount(fake.channel)
    await fake.push(rosterOf({ shells: [shell()] }))
    await act(async () => data().handleKill('shell_1'))
    await settle()
    expect(fake.callsOf(EClientRequest.KillShell)).toEqual([
      { op: EClientRequest.KillShell, params: { threadId: THREAD, shellId: 'shell_1' } },
    ])
    expect(data().busyId).toBe('shell_1')
    await fake.push(rosterOf({ shells: [shell({ totalCharacters: 90 })] }))
    expect(data().busyId).toBe('shell_1')
    await fake.push(rosterOf({ shells: [shell({ status: EShellStatus.Killed })] }))
    expect(data().busyId).toBeNull()
  })

  it('a refused kill surfaces the serve reason as the notice until the next action', async () => {
    const fake = fakeChannel(() => ({ ok: false, reason: 'no such shell' }))
    const data = await mount(fake.channel)
    await fake.push(rosterOf({ shells: [shell()] }))
    await act(async () => data().handleKill('shell_1'))
    await settle()
    expect(data().notice).toBe('no such shell')
    expect(data().busyId).toBeNull()
    await fake.push(rosterOf({ shells: [shell({ totalCharacters: 90 })] }))
    expect(data().notice).toBe('no such shell')
    await act(async () => data().handleSelect({ kind: EProcessKind.Shell, id: 'shell_1' }))
    expect(data().notice).toBeNull()
  })

  it('turns a reply the build cannot read into the notice and frees the row', async () => {
    const fake = fakeChannel(() => ({ unexpected: true }))
    const data = await mount(fake.channel)
    await fake.push(rosterOf({ shells: [shell()], services: [service()] }))
    await act(async () => data().handleKill('shell_1'))
    expect(data().notice).not.toBeNull()
    expect(data().busyId).toBeNull()
    let started: boolean | undefined
    await act(async () => {
      started = await data().handleStart('ls')
    })
    expect(started).toBe(false)
  })

  it('handleStop sends stop-service with the service id', async () => {
    const fake = fakeChannel(() => ({ ok: true, snapshot: service() }))
    const data = await mount(fake.channel)
    await fake.push(rosterOf({ services: [service()] }))
    await act(async () => data().handleStop('svc_1'))
    await settle()
    expect(fake.callsOf(EClientRequest.StopService)).toEqual([
      { op: EClientRequest.StopService, params: { serviceId: 'svc_1' } },
    ])
    expect(data().busyId).toBe('svc_1')
  })

  it('handleStart sends start-shell with the command as its description', async () => {
    const fake = fakeChannel(() => ({ ok: false, reason: 'refused' }))
    const data = await mount(fake.channel)
    let started: boolean | undefined
    await act(async () => {
      started = await data().handleStart('ls -la')
    })
    expect(started).toBe(false)
    expect(fake.callsOf(EClientRequest.StartShell)).toEqual([
      {
        op: EClientRequest.StartShell,
        params: { threadId: THREAD, command: 'ls -la', description: 'ls -la' },
      },
    ])
    expect(data().notice).toBe('refused')
  })

  it('shows a refused stop as the notice', async () => {
    const fake = fakeChannel(() => ({ ok: false, reason: 'service already stopped' }))
    const data = await mount(fake.channel)
    await fake.push(rosterOf({ services: [service()] }))
    await act(async () => data().handleStop('svc_1'))
    expect(data().notice).toBe('service already stopped')
    expect(data().busyId).toBeNull()
  })

  it('shows a lost request as the notice for kill, stop and start', async () => {
    const fake = fakeChannel((call) => {
      throw new RemoteRequestLost({ op: call.op, reason: 'the socket closed' })
    })
    const data = await mount(fake.channel)
    await fake.push(rosterOf({ shells: [shell()], services: [service()] }))
    for (const action of [
      () => data().handleKill('shell_1'),
      () => data().handleStop('svc_1'),
      () => data().handleStart('ls'),
    ]) {
      await act(async () => {
        await action()
      })
      expect(data().notice).toContain('the socket closed')
      expect(data().busyId).toBeNull()
    }
  })
})
