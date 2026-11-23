import { describe, expect, it } from 'bun:test'

import { EAgentStatus, inboxEventOf, toThreadId } from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import type { PodCrew } from '@dltech/atlas-plugin-sdk'

import { inboxInputOf } from '../child-message'
import { messagePayloadOf } from '../child-reports'
import { podMessagesOf } from '../../pod-messages'

const FROM = {
  agentId: toThreadId('a1'),
  agentType: 'general-purpose',
  intent: 'take the parser',
}

const eventOf = (args: { text: string }) => {
  const input = inboxInputOf({ ...args, from: FROM })
  const read = inboxEventOf(input.payload)
  if (!read.ok || read.event.type !== 'agent-reported') throw new Error('no agent-reported event')
  return { input, event: read.event }
}

describe('a message from one sub-agent to a sibling', () => {
  it('arrives as an agent-reported event naming the sender, not as a parent message', () => {
    const { input, event } = eventOf({ text: 'the parser is yours' })

    expect(input.kind).toBe('event')
    expect(event).toMatchObject({
      type: 'agent-reported',
      agentId: 'a1',
      agentType: 'general-purpose',
      intent: 'take the parser',
      prose: 'the parser is yours',
    })
    expect(JSON.stringify(event)).not.toContain('parent-agent')
  })

  it('gives the receiver a reply address of the sending sub-agent', () => {
    const { event } = eventOf({ text: 'the parser is yours' })

    expect(event.agentId).toBe(toThreadId('a1'))
    expect(event.prose).toBe('the parser is yours')
    expect(event).not.toHaveProperty('senderSessionId')
  })

  it('carries a reply to that address back to the sending sub-agent, not to the main thread', async () => {
    const said: { agentId: string; text: string }[] = []
    const reported: string[] = []
    const plane: Pick<ControlPlane, 'messagePeer' | 'reportToSpawner'> = {
      messagePeer: async () => ({ inboxId: 1 }),
      reportToSpawner: async () => {
        reported.push('main thread')
        return { inboxId: 1 }
      },
    }
    const crew: PodCrew = {
      spawn: async () => {
        throw new Error('this rig spawns nothing')
      },
      say: async (args) => {
        said.push(args)
        return {
          queued: false,
          snapshot: {
            agentId: toThreadId(args.agentId),
            agentType: 'general-purpose',
            intent: 'take the parser',
            status: EAgentStatus.Running,
            turns: 0,
            toolCalls: 0,
            startedAt: '2026-11-22T10:00:00.000Z',
          },
        }
      },
      stop: async () => {
        throw new Error('this rig stops nothing')
      },
      list: () => [],
      report: async () => {
        throw new Error('a sibling reply is not a report')
      },
    }
    const messages = podMessagesOf({ sessionId: 'session-1', selfAgentId: 'a2', crew, plane })

    const sent = await messages.send({ to: 'a1', text: 'understood' })

    expect(sent).toEqual({ delivered: true, to: 'a1', queued: false })
    expect(said).toEqual([{ agentId: 'a1', text: 'understood' }])
    expect(reported).toEqual([])
  })

  it('keeps a message from the parent in the parent lane', () => {
    expect(inboxInputOf({ text: 'steer' })).toEqual({
      kind: 'message',
      payload: messagePayloadOf({ text: 'steer' }),
    })
  })
})
