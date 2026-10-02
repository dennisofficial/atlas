import { describe, expect, it } from 'bun:test'

import {
  CHANNEL_PROTOCOL_VERSION,
  decodeClientFrame,
  decodeServeFrame,
  EAgentStatus,
  EClientFrame,
  EClientRequest,
  encodeFrame,
  EServeFrame,
  EServiceStatus,
  EShellStatus,
  ETurnStatus,
  readMemoryArchiveReplySchema,
  setThreadModelParamsSchema,
  type ClientFrame,
  type ServeFrame,
} from '../index'

describe('the send frame', () => {
  it('round-trips a bare text message unchanged', () => {
    const frame: ClientFrame = { kind: EClientFrame.Send, sendId: 'send-1' as never, text: 'hello' }

    expect(decodeClientFrame(encodeFrame(frame))).toEqual(frame)
  })

  it('round-trips images and context drafts, so a steered message lands as a local one would', () => {
    const frame: ClientFrame = {
      kind: EClientFrame.Send,
      sendId: 'send-2' as never,
      text: 'look at this',
      images: [
        { path: '/tmp/shot.png', mediaType: 'image/png', data: 'aGVsbG8=', width: 560, height: 280 },
      ],
      context: [
        { type: 'context-loaded', slot: 'skill', key: 'commit', content: 'commit prose' },
        {
          type: 'context-loaded',
          slot: 'file',
          key: 'src/a.ts',
          content: 'const a = 1',
          triggeredBy: 'mention',
        },
        { type: 'nudge', text: 'stay on task', lifetimeSteps: 2 },
        { type: 'user-said', text: 'quoted', via: 'operator' },
      ],
    }

    expect(decodeClientFrame(encodeFrame(frame))).toEqual(frame)
  })

  it('carries context opaquely — validating the drafts is the harness’s job at the decode seam', () => {
    const sendId = 'send-3' as const
    const raw = JSON.stringify({
      kind: EClientFrame.Send,
      sendId,
      text: 'go',
      context: [{ type: 'context-loaded', slot: 'skill' }],
    })

    expect(decodeClientFrame(raw)).toEqual({
      kind: EClientFrame.Send,
      sendId: sendId as never,
      text: 'go',
      context: [{ type: 'context-loaded', slot: 'skill' }],
    })
  })

  it('drops a send without a sendId — a re-drivable send must name its re-drive', () => {
    const raw = JSON.stringify({ kind: EClientFrame.Send, text: 'hello' })

    expect(decodeClientFrame(raw)).toBeNull()
  })
})

describe('the send ack', () => {
  it('round-trips the sendId the serve committed', () => {
    const frame: ServeFrame = { kind: EServeFrame.SendAcked, sendId: 'send-1' as never }

    expect(decodeServeFrame(encodeFrame(frame))).toEqual(frame)
  })

  it('drops an ack without a sendId', () => {
    expect(decodeServeFrame(JSON.stringify({ kind: EServeFrame.SendAcked }))).toBeNull()
  })
})

describe('the memory archive op', () => {
  it('round-trips a read-memory-archive request through the request frame', () => {
    const frame: ClientFrame = {
      kind: EClientFrame.Request,
      id: 'mem-1',
      op: EClientRequest.ReadMemoryArchive,
      params: {},
    }

    expect(decodeClientFrame(encodeFrame(frame))).toEqual(frame)
  })

  it('round-trips its reply — a base64 tar, empty when the sandbox holds no memory', () => {
    const reply = { archive: 'H4sIAAAAAAAAA2NgGAWjYGgH' }

    expect(readMemoryArchiveReplySchema.parse(reply)).toEqual(reply)
    expect(readMemoryArchiveReplySchema.parse({ archive: '' })).toEqual({ archive: '' })
  })

  it('drops a reply whose archive is not a string', () => {
    expect(readMemoryArchiveReplySchema.safeParse({ archive: 42 }).success).toBe(false)
  })
})

describe('the protocol stamp', () => {
  it('speaks the version that refuses broker-dependent serve runtimes', () => {
    expect(CHANNEL_PROTOCOL_VERSION).toBe(11)
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

describe('the roster frame', () => {
  it('round-trips the shells, agents and services a cloud surface reads', () => {
    const threadId = 'thread-cloud' as never
    const frame: ServeFrame = {
      kind: EServeFrame.Roster,
      roster: {
        shells: [
          {
            shellId: 'bash_1' as never,
            threadId,
            command: 'bun run dev',
            description: 'dev server',
            status: EShellStatus.Running,
            startedAt: '2026-09-24T10:00:00.000Z',
            lastOutputAt: '2026-09-24T10:00:01.000Z',
            totalCharacters: 64,
            awaitingInput: false,
          },
        ],
        agents: [
          {
            agentId: 'child-explore' as never,
            spawnedBy: threadId,
            agentType: 'explore',
            intent: 'map the seam',
            status: EAgentStatus.Running,
            turns: 1,
            toolCalls: 3,
            lastTool: undefined,
            startedAt: '2026-09-24T10:00:00.000Z',
            endedAt: undefined,
          },
        ],
        services: [
          {
            serviceId: 'svc_1',
            command: 'redis-server',
            description: 'cache',
            status: EServiceStatus.Running,
            logPath: '/tmp/svc_1.log',
            startedAt: '2026-09-24T10:00:00.000Z',
          },
        ],
      },
    }

    const decoded = decodeServeFrame(encodeFrame(frame))

    expect(decoded?.kind).toBe(EServeFrame.Roster)
    if (decoded?.kind !== EServeFrame.Roster) return
    expect(decoded.roster.shells[0]?.shellId as string).toBe('bash_1')
    expect(decoded.roster.agents[0]?.agentId as string).toBe('child-explore')
    expect(decoded.roster.services[0]?.serviceId as string).toBe('svc_1')
  })

  it('drops a frame whose roster is not the wire shape', () => {
    const raw = JSON.stringify({
      kind: 'roster',
      roster: { shells: [{ shellId: 42 }], agents: [], services: [] },
    })

    expect(decodeServeFrame(raw)).toBeNull()
  })
})
