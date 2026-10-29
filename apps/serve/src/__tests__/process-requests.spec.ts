import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'
import {
  EKilledBy,
  EServiceStatus,
  EShellStatus,
  EStopAction,
  toThreadId,
} from '@dltech/atlas-core'
import {
  EClientFrame,
  EClientRequest,
  EServeFrame,
  toShellId,
  type ServiceSnapshot,
  type ShellSnapshot,
  type StartShellArgs,
} from '@dltech/atlas-harness'

import { EWorkspaceState, startServe, type ServeHandle } from '../index'
import { answerProcessRequest, type ServeProcesses } from '../process-requests'
import type { RequestFrame } from '../request-reply'

import { connect } from './client'
import { fakeServeApp } from './fakes'

const threadId = toThreadId('thread-processes')
const TOKEN = 'session-token'

const SHELL: ShellSnapshot = {
  shellId: toShellId('shell-1'),
  threadId,
  command: 'bun run dev',
  description: 'dev server',
  status: EShellStatus.Running,
  startedAt: '2026-10-28T10:00:00.000Z',
  lastOutputAt: '2026-10-28T10:00:01.000Z',
  totalCharacters: 12,
  awaitingInput: false,
}

const SERVICE: ServiceSnapshot = {
  serviceId: 'svc-1',
  command: 'bun run preview',
  description: 'preview server',
  status: EServiceStatus.Running,
  logPath: '/nowhere/svc-1.log',
  startedAt: '2026-10-28T10:00:00.000Z',
}

const homes: string[] = []
const running: ServeHandle[] = []
let heldAtlasHome: string | undefined

afterEach(async () => {
  if (heldAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = heldAtlasHome
  heldAtlasHome = undefined
  while (running.length > 0) await running.pop()?.close()
  for (const home of homes.splice(0, homes.length)) rmSync(home, { recursive: true, force: true })
})

const scratch = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-serve-processes-'))
  homes.push(home)
  return home
}

const request = (args: { id: string; op: EClientRequest; params: unknown }): RequestFrame => ({
  kind: EClientFrame.Request,
  ...args,
})

const fakeProcesses = (overrides: {
  shells?: Partial<ServeProcesses['shells']>
  services?: Partial<ServeProcesses['services']>
}): ServeProcesses => ({
  shells: {
    start: async () => ({ ok: true, snapshot: SHELL }),
    peek: async () => 'tail',
    kill: () => ({ ok: true, snapshot: SHELL }),
    ...overrides.shells,
  },
  services: {
    list: () => [SERVICE],
    stop: () => ({ ok: true, snapshot: SERVICE, action: EStopAction.Term }),
    ...overrides.services,
  },
  cwd: '/workspace',
})

describe('answerProcessRequest', () => {
  it('starts a shell owned by the served conversation, defaulting the launch directory', async () => {
    const started: StartShellArgs[] = []
    const processes = fakeProcesses({
      shells: {
        start: async (args) => {
          started.push(args)
          return { ok: true, snapshot: SHELL }
        },
      },
    })

    const reply = await answerProcessRequest({
      frame: request({
        id: 'start-1',
        op: EClientRequest.StartShell,
        params: {
          threadId: 'someone-else',
          command: 'bun run dev',
          description: 'dev server',
        },
      }),
      threadId,
      processes,
    })

    expect(started).toEqual([
      {
        threadId,
        command: 'bun run dev',
        description: 'dev server',
        cwd: '/workspace',
      },
    ])
    expect(reply).toMatchObject({
      replyTo: 'start-1',
      ok: true,
      data: { ok: true, snapshot: { shellId: 'shell-1' } },
    })
  })

  it("reads a shell's output tail as an ok reply, and an unknown shell as a refusal", async () => {
    const tails: (string | undefined)[] = ['line one\nline two', undefined]
    const peeked: unknown[] = []
    const processes = fakeProcesses({
      shells: {
        peek: async (args) => {
          peeked.push(args)
          return tails.shift()
        },
      },
    })
    const read = (id: string) =>
      answerProcessRequest({
        frame: request({
          id,
          op: EClientRequest.ReadShellOutput,
          params: { threadId, shellId: 'shell-1', characters: 4000 },
        }),
        threadId,
        processes,
      })

    expect((await read('read-1')).data).toEqual({
      ok: true,
      text: 'line one\nline two',
    })
    expect((await read('read-2')).data).toEqual({
      ok: false,
      reason: 'no background shell is registered as "shell-1" for this conversation',
    })
    expect(peeked[0]).toEqual({
      threadId,
      shellId: 'shell-1',
      characters: 4000,
    })
  })

  it('kills as the operator, never as the model', async () => {
    const seen: { by: EKilledBy; threadId: unknown }[] = []
    const processes = fakeProcesses({
      shells: {
        kill: (args) => {
          seen.push({ by: args.by, threadId: args.threadId })
          return {
            ok: true,
            snapshot: {
              ...SHELL,
              status: EShellStatus.Killed,
              killedBy: args.by,
            },
            settled: Promise.resolve({ died: false }),
          }
        },
      },
    })

    const reply = await answerProcessRequest({
      frame: request({
        id: 'kill-1',
        op: EClientRequest.KillShell,
        params: { threadId, shellId: 'shell-1' },
      }),
      threadId,
      processes,
    })

    expect(seen).toEqual([{ by: EKilledBy.User, threadId }])
    expect(reply.data).toMatchObject({
      ok: true,
      snapshot: { killedBy: EKilledBy.User },
    })
    expect(Object.keys(reply.data as object)).not.toContain('settled')
  })

  it('hands a kill refusal through as a refused outcome, not a protocol error', async () => {
    const processes = fakeProcesses({
      shells: {
        kill: () => ({ ok: false, reason: 'no background shell "shell-9"' }),
      },
    })

    const reply = await answerProcessRequest({
      frame: request({
        id: 'kill-2',
        op: EClientRequest.KillShell,
        params: { threadId, shellId: 'shell-9' },
      }),
      threadId,
      processes,
    })

    expect(reply).toMatchObject({
      ok: true,
      data: { ok: false, reason: 'no background shell "shell-9"' },
    })
  })

  it('tails a service log by id, and answers an empty tail for an id the registry does not hold', async () => {
    const logPath = join(scratch(), 'svc-1.log')
    writeFileSync(logPath, 'listening on 4173\n')
    const processes = fakeProcesses({
      services: { list: () => [{ ...SERVICE, logPath }] },
    })
    const tail = (serviceId: string) =>
      answerProcessRequest({
        frame: request({
          id: `log-${serviceId}`,
          op: EClientRequest.ReadServiceLog,
          params: { serviceId, characters: 4000 },
        }),
        threadId,
        processes,
      })

    expect((await tail('svc-1')).data).toEqual({ text: 'listening on 4173\n' })
    expect((await tail('svc-2')).data).toEqual({ text: '' })
  })

  it('stops a service as the operator', async () => {
    const seen: EKilledBy[] = []
    const processes = fakeProcesses({
      services: {
        stop: (args) => {
          seen.push(args.by)
          return {
            ok: true,
            snapshot: {
              ...SERVICE,
              status: EServiceStatus.Killed,
              killedBy: args.by,
            },
            action: EStopAction.Term,
          }
        },
      },
    })

    const reply = await answerProcessRequest({
      frame: request({
        id: 'stop-1',
        op: EClientRequest.StopService,
        params: { serviceId: 'svc-1' },
      }),
      threadId,
      processes,
    })

    expect(seen).toEqual([EKilledBy.User])
    expect(reply.data).toMatchObject({
      ok: true,
      snapshot: { killedBy: EKilledBy.User },
    })
    expect(Object.keys(reply.data as object)).not.toContain('action')
  })

  it('refuses malformed params before the registry is touched', async () => {
    let touched = false
    const processes = fakeProcesses({
      shells: {
        kill: () => {
          touched = true
          return { ok: true, snapshot: SHELL }
        },
      },
    })

    const reply = await answerProcessRequest({
      frame: request({
        id: 'kill-3',
        op: EClientRequest.KillShell,
        params: {},
      }),
      threadId,
      processes,
    })

    expect(reply).toMatchObject({
      ok: false,
      data: { message: 'kill-shell wants { threadId, shellId }' },
    })
    expect(touched).toBe(false)
  })
})

describe('the process-control router branch', () => {
  it('refuses the ops on a serve composed without process registries', async () => {
    heldAtlasHome = process.env.ATLAS_HOME
    process.env.ATLAS_HOME = scratch()
    const app = fakeServeApp({ threadId, root: '/workspace' })
    const handle = await startServe({
      threadId,
      port: 0,
      token: TOKEN,
      controlPlaneUrl: 'https://api.example.com',
      env: {},
      cwd: '/workspace',
      compose: async () => app,
      ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
      fetchFn: (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
    })
    running.push(handle)
    const client = await connect({ port: handle.port, token: TOKEN })
    client.send({
      kind: EClientFrame.Hello,
      threadId,
      channelCursor: null,
      lastEventSeq: 0,
    })
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    client.send({
      kind: EClientFrame.Request,
      id: 'kill-4',
      op: EClientRequest.KillShell,
      params: { threadId, shellId: 'shell-1' },
    })
    const reply = await client.waitFor(
      (frame) => frame.kind === EServeFrame.Reply && frame.replyTo === 'kill-4',
    )

    expect(reply).toMatchObject({
      ok: false,
      data: { message: 'this serve holds no process registries' },
    })
  })
})
