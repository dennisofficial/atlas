import { describe, expect, it } from 'bun:test'

import {
  EAgentStatus,
  EMessageOrigin,
  EServiceStatus,
  EShellStatus,
  toThreadId,
} from '@dltech/atlas-core'

import {
  decodeClientFrame,
  decodeServeFrame,
  EClientFrame,
  encodeFrame,
  EServeFrame,
  type ClientFrame,
  type ServeFrame,
} from '../channel-wire'

describe('the send frame', () => {
  it('round-trips a bare text message unchanged', () => {
    const frame: ClientFrame = { kind: EClientFrame.Send, text: 'hello' }

    expect(decodeClientFrame(encodeFrame(frame))).toEqual(frame)
  })

  it('round-trips images and context drafts, so a steered message lands as a local one would', () => {
    const frame: ClientFrame = {
      kind: EClientFrame.Send,
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
        { type: 'user-said', text: 'quoted', via: EMessageOrigin.Operator },
      ],
    }

    expect(decodeClientFrame(encodeFrame(frame))).toEqual(frame)
  })

  it('carries context drafts opaquely; the serve validates them against eventBodySchema at the seam', () => {
    const raw = JSON.stringify({
      kind: EClientFrame.Send,
      text: 'go',
      context: [{ type: 'context-loaded', slot: 'skill' }],
    })

    expect(decodeClientFrame(raw)).toEqual({
      kind: EClientFrame.Send,
      text: 'go',
      context: [{ type: 'context-loaded', slot: 'skill' }],
    })
  })
})

describe('the roster frame', () => {
  it('round-trips the shells, agents and services a cloud surface reads', () => {
    const threadId = toThreadId('thread-cloud')
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
            agentId: toThreadId('child-explore'),
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
    expect(decoded.roster.services[0]?.serviceId).toBe('svc_1')
  })

  it('drops a frame whose roster is not the wire shape', () => {
    const raw = JSON.stringify({
      kind: 'roster',
      roster: { shells: [{ shellId: 42 }], agents: [], services: [] },
    })

    expect(decodeServeFrame(raw)).toBeNull()
  })
})
