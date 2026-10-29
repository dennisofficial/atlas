import { describe, expect, it } from 'bun:test'

import {
  CHANNEL_PROTOCOL_VERSION,
  decodeClientFrame,
  decodeServeFrame,
  EClientFrame,
  EClientRequest,
  encodeFrame,
  EServeFrame,
  ETurnStatus,
  killShellReplySchema,
  readShellOutputParamsSchema,
  setThreadModelParamsSchema,
  type ClientFrame,
  type ServeFrame,
} from '../index'

describe('the protocol stamp', () => {
  it('speaks the current protocol version', () => {
    expect(CHANNEL_PROTOCOL_VERSION).toBe(31)
  })
})

describe('the settings frame', () => {
  it('round-trips the serialised user settings document unchanged', () => {
    const frame: ClientFrame = {
      kind: EClientFrame.Settings,
      content: '{\n  "sidebar.width": 70\n}\n',
    }

    expect(decodeClientFrame(encodeFrame(frame))).toEqual(frame)
  })

  it('drops a settings frame without content', () => {
    const raw = JSON.stringify({ kind: EClientFrame.Settings })

    expect(decodeClientFrame(raw)).toBeNull()
  })

  it('drops a settings frame whose content is not a string', () => {
    const raw = JSON.stringify({
      kind: EClientFrame.Settings,
      content: { 'sidebar.width': 70 },
    })

    expect(decodeClientFrame(raw)).toBeNull()
  })
})

describe('the run frame', () => {
  it('round-trips a bare run unchanged', () => {
    const frame: ClientFrame = { kind: EClientFrame.Run }

    expect(decodeClientFrame(encodeFrame(frame))).toEqual({
      kind: EClientFrame.Run,
    })
    expect(encodeFrame(frame)).toBe('{"kind":"run"}')
  })

  it('round-trips the optional resume flag', () => {
    const frame: ClientFrame = { kind: EClientFrame.Run, resume: true }

    expect(decodeClientFrame(encodeFrame(frame))).toEqual(frame)
  })

  it('drops a run frame whose resume flag is not a boolean', () => {
    expect(decodeClientFrame('{"kind":"run","resume":"yes"}')).toBeNull()
  })

  it('leaves the relocation resume frame bare', () => {
    expect(decodeClientFrame(encodeFrame({ kind: EClientFrame.Resume }))).toEqual({
      kind: EClientFrame.Resume,
    })
  })
})

describe('the thread rename and model ops', () => {
  it('round-trips a rename request and its broadcast', () => {
    const request: ClientFrame = {
      kind: EClientFrame.Request,
      id: 'ren-1',
      op: EClientRequest.RenameThread,
      params: { threadId: 'thread-1', title: 'a better title' },
    }
    const pushed: ServeFrame = {
      kind: EServeFrame.ThreadRenamed,
      threadId: 'thread-1' as never,
      title: 'a better title',
    }

    expect(decodeClientFrame(encodeFrame(request))).toEqual(request)
    expect(decodeServeFrame(encodeFrame(pushed))).toEqual(pushed)
  })

  it('round-trips a set-thread-model request and its broadcast', () => {
    const request: ClientFrame = {
      kind: EClientFrame.Request,
      id: 'mod-1',
      op: EClientRequest.SetThreadModel,
      params: {
        threadId: 'thread-1',
        model: { ref: 'anthropic/claude-opus-5', effort: 'high' },
      },
    }
    const pushed: ServeFrame = {
      kind: EServeFrame.ThreadModelChanged,
      threadId: 'thread-1' as never,
      model: { ref: 'anthropic/claude-opus-5', effort: 'high' },
    }

    expect(decodeClientFrame(encodeFrame(request))).toEqual(request)
    expect(decodeServeFrame(encodeFrame(pushed))).toEqual(pushed)
  })

  it('keeps retarget true, false and omitted exactly as sent on a set-thread-model request', () => {
    const model = { ref: 'anthropic/claude-opus-5', effort: 'high' }
    const requests = [
      { threadId: 'thread-1', model },
      { threadId: 'thread-1', model, retarget: true },
      { threadId: 'thread-1', model, retarget: false },
    ]

    for (const params of requests) {
      const request: ClientFrame = {
        kind: EClientFrame.Request,
        id: 'mod-2',
        op: EClientRequest.SetThreadModel,
        params,
      }
      expect(decodeClientFrame(encodeFrame(request))).toEqual(request)
      expect(JSON.stringify(setThreadModelParamsSchema.parse(params))).toBe(JSON.stringify(params))
    }
  })

  it('rejects a set-thread-model request whose retarget is not a boolean', () => {
    const params = {
      threadId: 'thread-1',
      model: { ref: 'anthropic/claude-opus-5', effort: 'high' },
      retarget: 'yes',
    }

    expect(setThreadModelParamsSchema.safeParse(params).success).toBe(false)
  })

  it('drops a model push whose model is not a { ref, effort } pair', () => {
    expect(
      decodeServeFrame(
        JSON.stringify({
          kind: EServeFrame.ThreadModelChanged,
          threadId: 'thread-1',
          model: { ref: 'anthropic/claude-opus-5' },
        }),
      ),
    ).toBeNull()
  })
})

describe('the pause frames', () => {
  it('round-trips pause and resume client frames', () => {
    for (const frame of [{ kind: EClientFrame.Pause }, { kind: EClientFrame.Resume }] as const) {
      expect(decodeClientFrame(encodeFrame(frame))).toEqual(frame)
    }
  })

  it('round-trips a turn ended by a relocation pause', () => {
    const frame: ServeFrame = {
      kind: EServeFrame.TurnEnded,
      outcome: {
        status: ETurnStatus.RelocationPaused,
        runId: 'run-1' as never,
      },
    }

    expect(decodeServeFrame(encodeFrame(frame))).toEqual(frame)
  })
})

describe('the process-control ops', () => {
  const shell = {
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

  it('round-trips a request frame for each of the five ops', () => {
    const requests = [
      {
        op: EClientRequest.StartShell,
        params: { threadId: 'thread-1', command: 'ls', description: 'list' },
      },
      {
        op: EClientRequest.ReadShellOutput,
        params: { threadId: 'thread-1', shellId: 'shell-1', characters: 4000 },
      },
      {
        op: EClientRequest.KillShell,
        params: { threadId: 'thread-1', shellId: 'shell-1' },
      },
      { op: EClientRequest.StopService, params: { serviceId: 'svc-1' } },
      {
        op: EClientRequest.ReadServiceLog,
        params: { serviceId: 'svc-1', characters: 4000 },
      },
    ]

    for (const [index, { op, params }] of requests.entries()) {
      const frame: ClientFrame = {
        kind: EClientFrame.Request,
        id: `proc-${index}`,
        op,
        params,
      }
      expect(decodeClientFrame(encodeFrame(frame))).toEqual(frame)
    }
  })

  it('rejects a shell-output read whose character budget is not positive', () => {
    const params = { threadId: 'thread-1', shellId: 'shell-1' }

    expect(readShellOutputParamsSchema.safeParse({ ...params, characters: 0 }).success).toBe(false)
    expect(readShellOutputParamsSchema.safeParse({ ...params, characters: 1 }).success).toBe(true)
  })

  it('accepts both arms of a kill reply and refuses an ok arm without a snapshot', () => {
    expect(killShellReplySchema.safeParse({ ok: true, snapshot: shell }).success).toBe(true)
    expect(killShellReplySchema.safeParse({ ok: false, reason: 'gone' }).success).toBe(true)
    expect(killShellReplySchema.safeParse({ ok: true }).success).toBe(false)
  })
})
