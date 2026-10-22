import { describe, expect, it } from 'bun:test'

import {
  agentOutcomeWireSchema,
  decodeClientFrame,
  decodeServeFrame,
  EAgentStatus,
  EClientFrame,
  EClientRequest,
  encodeFrame,
  EServeFrame,
  EServiceStatus,
  EShellStatus,
  resumeAgentParamsSchema,
  sayToAgentParamsSchema,
  stopAgentParamsSchema,
  takeBackPendingParamsSchema,
  takeBackPendingReplySchema,
  type ClientFrame,
  type ServeFrame,
} from '../index'

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

describe('the take-back-pending request', () => {
  it('round-trips its request frame', () => {
    const frame: ClientFrame = {
      kind: EClientFrame.Request,
      id: 'req-1',
      op: EClientRequest.TakeBackPending,
      params: { threadId: 'brn_cloud' },
    }

    expect(decodeClientFrame(encodeFrame(frame))).toEqual(frame)
    expect(String(takeBackPendingParamsSchema.parse({ threadId: 'brn_cloud' }).threadId)).toBe('brn_cloud')
  })

  it('parses a reply with nothing to take back', () => {
    expect(takeBackPendingReplySchema.parse({ taken: null })).toEqual({ taken: null })
  })

  it('parses a reply carrying the taken message with its attachments and context', () => {
    const reply = {
      taken: {
        text: 'actually, do X',
        images: [{ path: '/tmp/shot.png', mediaType: 'image/png', data: 'aGVsbG8=' }],
        files: [{ path: '/tmp/a.txt', mediaType: 'text/plain', data: 'aGk=', filename: 'a.txt' }],
        context: [{ type: 'context-loaded', slot: 'skill', key: 'commit', content: 'prose' }],
      },
    }

    expect(takeBackPendingReplySchema.parse(reply)).toEqual(reply)
  })

  it('drops a reply whose taken message has no text', () => {
    expect(takeBackPendingReplySchema.safeParse({ taken: { images: [], files: [] } }).success).toBe(false)
  })
})

describe('the agent-steer ops', () => {
  it('round-trips a say-to-agent request carrying text, images and files like a send would', () => {
    const request: ClientFrame = {
      kind: EClientFrame.Request,
      id: 'steer-1',
      op: EClientRequest.SayToAgent,
      params: {
        threadId: 'brn_main',
        agentId: 'brn_child',
        text: 'keep the commits conventional',
        images: [{ path: '/tmp/shot.png', mediaType: 'image/png', data: 'aGVsbG8=' }],
        files: [{ path: '/tmp/note.md', mediaType: 'text/markdown', data: 'aGVsbG8=' }],
      },
    }

    expect(decodeClientFrame(encodeFrame(request))).toEqual(request)
    expect(JSON.stringify(sayToAgentParamsSchema.parse(request.params))).toBe(
      JSON.stringify(request.params),
    )
  })

  it('round-trips a bare say-to-agent request with the attachments omitted', () => {
    const request: ClientFrame = {
      kind: EClientFrame.Request,
      id: 'steer-2',
      op: EClientRequest.SayToAgent,
      params: { threadId: 'brn_main', agentId: 'brn_child', text: 'status?' },
    }

    expect(decodeClientFrame(encodeFrame(request))).toEqual(request)
  })

  it('rejects a say-to-agent whose text is missing — a steer must carry the message', () => {
    const params = { threadId: 'brn_main', agentId: 'brn_child' }

    expect(sayToAgentParamsSchema.safeParse(params).success).toBe(false)
  })

  it('round-trips resume-agent and stop-agent as address-only requests', () => {
    for (const op of [EClientRequest.ResumeAgent, EClientRequest.StopAgent]) {
      const request: ClientFrame = {
        kind: EClientFrame.Request,
        id: 'steer-3',
        op,
        params: { threadId: 'brn_main', agentId: 'brn_child' },
      }

      expect(decodeClientFrame(encodeFrame(request))).toEqual(request)
    }
  })

  it('rejects a resume or stop request that names no agent', () => {
    expect(resumeAgentParamsSchema.safeParse({ threadId: 'brn_main' }).success).toBe(false)
    expect(stopAgentParamsSchema.safeParse({ threadId: 'brn_main' }).success).toBe(false)
  })
})

describe('the agent outcome reply', () => {
  it('parses a successful outcome with the agent snapshot the roster already carries', () => {
    const parsed = agentOutcomeWireSchema.parse({
      ok: true,
      snapshot: {
        agentId: 'brn_child',
        spawnedBy: 'brn_main',
        agentType: 'explore',
        intent: 'map the registry',
        status: EAgentStatus.Running,
        turns: 3,
        toolCalls: 9,
        startedAt: '2026-10-02T20:00:00.000Z',
      },
    })

    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(String(parsed.snapshot.agentId)).toBe('brn_child')
      expect(parsed.snapshot.turns).toBe(3)
      expect(parsed.snapshot.lastTool).toBeUndefined()
    }
  })

  it("round-trips a refusal with the registry's prose reason unchanged", () => {
    const outcome = { ok: false as const, reason: 'agent brn_child is already taking a step' }

    expect(agentOutcomeWireSchema.parse(outcome)).toEqual(outcome)
  })

  it('rejects an outcome that claims success without the snapshot', () => {
    expect(agentOutcomeWireSchema.safeParse({ ok: true, reason: 'fine' }).success).toBe(false)
    expect(agentOutcomeWireSchema.safeParse({ ok: false }).success).toBe(false)
  })
})

describe('the pending-changed signal', () => {
  it('round-trips through a signal frame, queue entries and all', () => {
    const frame: ServeFrame = {
      kind: EServeFrame.Signal,
      seq: 7,
      signal: {
        type: 'pending-changed',
        entries: [
          { id: 'pending-1', text: 'first', reserved: true },
          { id: 'pending-2', text: 'second', via: 'parent-agent', reserved: false },
        ],
      },
    }

    expect(decodeServeFrame(encodeFrame(frame))).toEqual(frame)
  })

  it('round-trips an emptied queue', () => {
    const frame: ServeFrame = {
      kind: EServeFrame.Signal,
      seq: 8,
      signal: { type: 'pending-changed', entries: [] },
    }

    expect(decodeServeFrame(encodeFrame(frame))).toEqual(frame)
  })

  it('drops an entry with an empty id', () => {
    const raw = JSON.stringify({
      kind: EServeFrame.Signal,
      seq: 9,
      signal: { type: 'pending-changed', entries: [{ id: '', text: 'x', reserved: false }] },
    })

    expect(decodeServeFrame(raw)).toBeNull()
  })
})
