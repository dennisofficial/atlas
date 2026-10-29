import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'
import { EKilledBy, EServiceStatus, EShellStatus, EStopAction } from '@dltech/atlas-core'
import { EClientFrame, EClientRequest, type StartShellArgs } from '@dltech/atlas-harness'

import { answerProcessRequest } from '../process-requests'
import type { RequestFrame } from '../request-reply'

import { fakeProcesses, SERVICE, SHELL, threadId } from './process-requests-fixture'

const homes: string[] = []

afterEach(() => {
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
