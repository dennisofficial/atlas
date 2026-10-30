import { describe, expect, it } from 'bun:test'

import type { DeclaredServicesViewWire } from '@dltech/atlas-wire/web'

import { EClientRequest } from '../channel-wire'
import { RemoteRequestFailed, RemoteRequestLost } from '../remote-channel-upstream'
import {
  ensureDeclaredServices,
  killShell,
  listDeclaredServices,
  readServiceLog,
  readShellOutput,
  restartService,
  startShell,
  stopService,
  type RequestChannel,
} from '../session-tools'

const SHELL = {
  shellId: 'shell-1',
  threadId: 'thread-1',
  command: 'bun run dev',
  description: 'dev server',
  status: 'running',
  startedAt: '2026-10-28T10:00:00.000Z',
  lastOutputAt: '2026-10-28T10:00:01.000Z',
  totalCharacters: 12,
  awaitingInput: false,
}

const fakeChannel = (answer: (op: EClientRequest) => unknown) => {
  const requests: { op: EClientRequest; params: unknown }[] = []
  const channel: RequestChannel = {
    request: async ({ op, params }) => {
      requests.push({ op, params })
      return answer(op)
    },
  }
  return { channel, requests }
}

const refusing = () =>
  fakeChannel((op) => {
    throw new RemoteRequestFailed({
      op,
      data: { message: 'unknown request op' },
    })
  })

describe('the process-control helpers', () => {
  it('startShell sends start-shell with thread, command and description and parses the started reply', async () => {
    const { channel, requests } = fakeChannel(() => ({
      ok: true,
      snapshot: SHELL,
    }))

    const reply = await startShell({
      channel,
      threadId: 'thread-1',
      command: 'bun run dev',
      description: 'dev server',
    })

    expect(requests).toEqual([
      {
        op: EClientRequest.StartShell,
        params: {
          threadId: 'thread-1',
          command: 'bun run dev',
          description: 'dev server',
        },
      },
    ])
    expect(reply).toMatchObject({ ok: true, snapshot: { shellId: 'shell-1' } })
  })

  it('readShellOutput returns the ok arm with the tail text', async () => {
    const { channel, requests } = fakeChannel(() => ({
      ok: true,
      text: 'line one\nline two',
    }))

    const reply = await readShellOutput({
      channel,
      threadId: 'thread-1',
      shellId: 'shell-1',
      characters: 4000,
    })

    expect(requests[0]).toEqual({
      op: EClientRequest.ReadShellOutput,
      params: { threadId: 'thread-1', shellId: 'shell-1', characters: 4000 },
    })
    expect(reply).toEqual({ ok: true, text: 'line one\nline two' })
  })

  it("killShell returns the sandbox's refusal verbatim when the reply is the refused arm", async () => {
    const { channel } = fakeChannel(() => ({
      ok: false,
      reason: 'shell shell-1 already ended',
    }))

    const reply = await killShell({
      channel,
      threadId: 'thread-1',
      shellId: 'shell-1',
    })

    expect(reply).toEqual({ ok: false, reason: 'shell shell-1 already ended' })
  })

  it('stopService and readServiceLog send the service id and parse the reply', async () => {
    const service = {
      serviceId: 'svc-1',
      command: 'bun run dev',
      description: 'dev server',
      status: 'killed',
      logPath: '/tmp/svc-1.log',
      startedAt: '2026-10-28T10:00:00.000Z',
    }
    const { channel, requests } = fakeChannel((op) =>
      op === EClientRequest.StopService ? { ok: true, snapshot: service } : { text: 'ready' },
    )

    const stopped = await stopService({ channel, serviceId: 'svc-1' })
    const log = await readServiceLog({
      channel,
      serviceId: 'svc-1',
      characters: 4000,
    })

    expect(requests).toEqual([
      { op: EClientRequest.StopService, params: { serviceId: 'svc-1' } },
      {
        op: EClientRequest.ReadServiceLog,
        params: { serviceId: 'svc-1', characters: 4000 },
      },
    ])
    expect(stopped).toMatchObject({
      ok: true,
      snapshot: { serviceId: 'svc-1' },
    })
    expect(log).toBe('ready')
  })

  it('a refused request becomes a refused outcome, never a throw', async () => {
    const { channel } = refusing()

    const killed = await killShell({
      channel,
      threadId: 'thread-1',
      shellId: 'shell-1',
    })
    const stopped = await stopService({ channel, serviceId: 'svc-1' })
    const log = await readServiceLog({
      channel,
      serviceId: 'svc-1',
      characters: 4000,
    })

    expect(killed).toEqual({
      ok: false,
      reason: 'The sandbox refused the kill-shell request: unknown request op.',
    })
    expect(stopped).toEqual({
      ok: false,
      reason: 'The sandbox refused the stop-service request: unknown request op.',
    })
    expect(log).toBe('')
  })

  it('a request the socket never answered reads as a refusal, never a throw', async () => {
    const { channel } = fakeChannel((op) => {
      throw new RemoteRequestLost({ op, reason: 'the socket closed' })
    })

    const output = await readShellOutput({
      channel,
      threadId: 'thread-1',
      shellId: 'shell-1',
      characters: 4000,
    })
    const log = await readServiceLog({ channel, serviceId: 'svc-1', characters: 4000 })

    expect(output).toEqual({
      ok: false,
      reason: 'The read-shell-output request was never answered: the socket closed.',
    })
    expect(log).toBe('')
  })

  it('an off-shape reply still throws so the caller can name it', async () => {
    const { channel } = fakeChannel(() => ({ puzzling: true }))

    await expect(killShell({ channel, threadId: 'thread-1', shellId: 'shell-1' })).rejects.toThrow()
  })
})

describe('the declared-services helpers', () => {
  it('listDeclaredServices sends an empty request and parses the view', async () => {
    const view: DeclaredServicesViewWire = {
      services: [{ name: 'web', state: 'stopped', links: [] }],
      rejections: [],
    }
    const { channel, requests } = fakeChannel(() => ({ ok: true, view }))

    const reply = await listDeclaredServices({ channel })

    expect(requests).toEqual([{ op: EClientRequest.ListDeclaredServices, params: {} }])
    expect(reply).toEqual({ ok: true, view })
  })

  it('ensureDeclaredServices sends names only when given', async () => {
    const { channel, requests } = fakeChannel(() => ({ ok: true, results: [] }))

    await ensureDeclaredServices({ channel })
    await ensureDeclaredServices({ channel, names: ['web'] })

    expect(requests.map((entry) => entry.params)).toEqual([{}, { names: ['web'] }])
  })

  it('restartService sends the service id', async () => {
    const { channel, requests } = fakeChannel(() => ({ ok: false, reason: 'gone' }))

    const reply = await restartService({ channel, serviceId: 'svc-1' })

    expect(requests).toEqual([
      { op: EClientRequest.RestartService, params: { serviceId: 'svc-1' } },
    ])
    expect(reply).toEqual({ ok: false, reason: 'gone' })
  })

  it('reads a refused op as a refusal for all three', async () => {
    const { channel } = refusing()

    expect(await listDeclaredServices({ channel })).toMatchObject({ ok: false })
    expect(await ensureDeclaredServices({ channel })).toMatchObject({ ok: false })
    expect(await restartService({ channel, serviceId: 's' })).toMatchObject({ ok: false })
  })
})
