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
  setThreadModelParamsSchema,
  type ClientFrame,
  type ServeFrame,
} from '../index'

describe('the protocol stamp', () => {
  it('speaks the version carrying family workspace mappings and cleanup proofs', () => {
    expect(CHANNEL_PROTOCOL_VERSION).toBe(20)
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
    const raw = JSON.stringify({ kind: EClientFrame.Settings, content: { 'sidebar.width': 70 } })

    expect(decodeClientFrame(raw)).toBeNull()
  })
})

describe('the run frame', () => {
  it('round-trips a bare run unchanged', () => {
    const frame: ClientFrame = { kind: EClientFrame.Run }

    expect(decodeClientFrame(encodeFrame(frame))).toEqual({ kind: EClientFrame.Run })
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
      params: { threadId: 'thread-1', model: { ref: 'anthropic/claude-opus-5', effort: 'high' } },
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
    for (const frame of [
      { kind: EClientFrame.Pause },
      { kind: EClientFrame.Resume },
    ] as const) {
      expect(decodeClientFrame(encodeFrame(frame))).toEqual(frame)
    }
  })

  it('round-trips a turn ended by a relocation pause', () => {
    const frame: ServeFrame = {
      kind: EServeFrame.TurnEnded,
      outcome: { status: ETurnStatus.RelocationPaused, runId: 'run-1' as never },
    }

    expect(decodeServeFrame(encodeFrame(frame))).toEqual(frame)
  })
})
