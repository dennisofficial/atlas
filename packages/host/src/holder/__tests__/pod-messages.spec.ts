import { describe, expect, it } from 'bun:test'

import { EAgentStatus } from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import type { PodCrew, SubagentSaid } from '@dltech/atlas-plugin-sdk'

import { FIND_IDS, podMessagesOf } from '../pod-messages'

const SESSION = 'session-1'

type PeerCall = { fromSessionId: string; toSessionId: string; text: string }

const planeOf = (args: {
  peerRefused?: string | undefined
  reportRefused?: string | undefined
  calls: PeerCall[]
}): Pick<ControlPlane, 'messagePeer' | 'reportToSpawner'> => ({
  messagePeer: async (params) => {
    args.calls.push(params)
    return args.peerRefused === undefined ? { inboxId: 1 } : { refused: args.peerRefused }
  },
  reportToSpawner: async () =>
    args.reportRefused === undefined ? { inboxId: 1 } : { refused: args.reportRefused },
})

const snapshot = {
  agentId: 'a1',
  agentType: 'general-purpose',
  intent: 'trace the port',
  status: EAgentStatus.Running,
  turns: 0,
  toolCalls: 0,
  startedAt: '2026-11-09T10:00:00.000Z',
} as const

const crewOf = (args: {
  said?: SubagentSaid | undefined
  calls: { agentId: string; text: string }[]
  reported: string[]
}): PodCrew => ({
  spawn: async () => {
    throw new Error('this rig spawns nothing')
  },
  say: async (said) => {
    args.calls.push(said)
    return args.said
  },
  stop: async () => {
    throw new Error('this rig stops nothing')
  },
  list: () => [],
  report: async ({ text }) => {
    args.reported.push(text)
    return snapshot
  },
})

const sentOf = (args: { said?: SubagentSaid | undefined; peerRefused?: string | undefined }) => {
  const said: { agentId: string; text: string }[] = []
  const reported: string[] = []
  const peer: PeerCall[] = []
  return {
    said,
    reported,
    peer,
    messages: podMessagesOf({
      sessionId: SESSION,
      crew: crewOf({ said: args.said, calls: said, reported }),
      plane: planeOf({ peerRefused: args.peerRefused, calls: peer }),
    }),
  }
}

describe('send_message routing', () => {
  it('sends to a sub-agent of this thread first, and never to a session of that id', async () => {
    const rig = sentOf({ said: { queued: false, snapshot } })
    const sent = await rig.messages.send({ to: 'a1', text: 'more' })

    expect(sent).toEqual({ delivered: true, to: 'a1', queued: false })
    expect(rig.said).toEqual([{ agentId: 'a1', text: 'more' }])
    expect(rig.peer).toEqual([])
  })

  it('falls through to a session of the same user when no sub-agent has the id', async () => {
    const rig = sentOf({})
    const sent = await rig.messages.send({ to: 'session-2', text: 'hello' })

    expect(sent).toEqual({ delivered: true, to: 'session-2', queued: false })
    expect(rig.peer).toEqual([{ fromSessionId: SESSION, toSessionId: 'session-2', text: 'hello' }])
  })

  it('refuses an id that is neither a sub-agent nor a session, keeping the reason and naming how to find ids', async () => {
    const rig = sentOf({ peerRefused: 'there is no session nope in this project' })
    const sent = await rig.messages.send({ to: 'nope', text: 'hello' })

    expect(sent).toEqual({ refused: `there is no session nope in this project. ${FIND_IDS}` })
  })

  it('keeps the reason an archived session gives instead of calling it missing', async () => {
    const rig = sentOf({
      peerRefused:
        'session peer-1 is archived, so it cannot act on a message. The operator can unarchive it.',
    })
    const sent = await rig.messages.send({ to: 'peer-1', text: 'hello' })

    expect(sent).toEqual({
      refused: `session peer-1 is archived, so it cannot act on a message. The operator can unarchive it. ${FIND_IDS}`,
    })
  })

  it('refuses its own session id', async () => {
    const rig = sentOf({})
    expect(await rig.messages.send({ to: SESSION, text: 'hello' })).toEqual({
      refused: `that is this session. ${FIND_IDS}`,
    })
    expect(rig.peer).toEqual([])
  })

  it('reports to the spawner for "parent"', async () => {
    const rig = sentOf({})
    expect(await rig.messages.send({ to: 'parent', text: 'the parser is green' })).toEqual({
      delivered: true,
      to: 'parent',
      queued: false,
    })
    expect(rig.reported).toEqual([])
  })

  it('turns a session with no spawner into a refusal', async () => {
    const said: { agentId: string; text: string }[] = []
    const messages = podMessagesOf({
      sessionId: SESSION,
      crew: crewOf({ calls: said, reported: [] }),
      plane: planeOf({
        reportRefused: 'this session was not created by another session, so it has no spawner',
        calls: [],
      }),
    })
    expect(await messages.send({ to: 'parent', text: 'hello' })).toEqual({
      refused: `this session was not created by another session, so it has no spawner. ${FIND_IDS}`,
    })
  })
})

describe('send_message from a sub-agent', () => {
  const childOf = (args: { said?: SubagentSaid | undefined }) => {
    const said: { agentId: string; text: string }[] = []
    const reported: string[] = []
    const peer: PeerCall[] = []
    return {
      said,
      reported,
      peer,
      messages: podMessagesOf({
        sessionId: SESSION,
        selfAgentId: 'a1',
        crew: crewOf({ said: args.said, calls: said, reported }),
        plane: planeOf({ calls: peer }),
      }),
    }
  }

  it('reports to its own parent', async () => {
    const rig = childOf({})
    expect(await rig.messages.send({ to: 'parent', text: 'done reading' })).toEqual({
      delivered: true,
      to: 'parent',
      queued: false,
    })
    expect(rig.reported).toEqual(['done reading'])
    expect(rig.peer).toEqual([])
  })

  it('reaches a sibling sub-agent', async () => {
    const rig = childOf({ said: { queued: true, snapshot } })
    expect(await rig.messages.send({ to: 'a2', text: 'take the parser' })).toEqual({
      delivered: true,
      to: 'a2',
      queued: true,
    })
    expect(rig.said).toEqual([{ agentId: 'a2', text: 'take the parser' }])
  })

  it('refuses its own sub-agent id', async () => {
    const rig = childOf({})
    expect(await rig.messages.send({ to: 'a1', text: 'hello' })).toEqual({
      refused: `that is this sub-agent. ${FIND_IDS}`,
    })
  })

  it('reaches a session of the same user', async () => {
    const rig = childOf({})
    expect(await rig.messages.send({ to: 'session-2', text: 'hello' })).toEqual({
      delivered: true,
      to: 'session-2',
      queued: false,
    })
    expect(rig.peer).toHaveLength(1)
  })
})
