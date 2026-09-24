import { describe, expect, it } from 'bun:test'

import { toThreadId, type RewindCut, type ThreadId } from '@dltech/atlas-core'

import type { RewindRead } from '../../store/rewind-machinery'
import {
  RemoteRewindMachinery,
  rewindApplyParamsOf,
  type ChannelRewindPort,
} from '../remote-rewind-machinery'

const threadId: ThreadId = toThreadId('thr-1')

const shellCut: RewindCut = {
  kind: 'shell',
  seq: 3,
  shellId: 'bash_1',
  command: 'npm test',
  description: 'Run a background job',
}

const agentCut: RewindCut = {
  kind: 'agent',
  seq: 4,
  agentId: toThreadId('thr-child'),
  agentType: 'builder',
  intent: 'Fix the failing test',
}

const rosterRead = (args: {
  cuts: readonly RewindCut[]
  threadId: ThreadId
}): Promise<RewindRead> =>
  Promise.resolve({
    reachable: true,
    kills: args.cuts.map((cut) =>
      cut.kind === 'agent'
        ? {
            kind: 'agent' as const,
            agentId: cut.agentId,
            agentType: cut.agentType,
            intent: cut.intent,
            running: true,
          }
        : cut.kind === 'shell'
          ? {
              kind: 'shell' as const,
              shellId: cut.shellId,
              command: cut.command,
              description: cut.description,
              running: true,
            }
          : {
              kind: 'service' as const,
              serviceId: cut.serviceId,
              command: cut.command,
              description: cut.description,
              running: false,
            },
    ),
  })

class ScriptedChannel implements ChannelRewindPort {
  failApply: Error | null = null
  readonly applied: { threadId: ThreadId; cuts: readonly RewindCut[] }[] = []

  apply(args: { threadId: ThreadId; cuts: readonly RewindCut[] }): Promise<void> {
    if (this.failApply !== null) return Promise.reject(this.failApply)
    this.applied.push(args)
    return Promise.resolve()
  }
}

describe('RemoteRewindMachinery', () => {
  it('prices the confirmation through the roster read it was given', async () => {
    const channel = new ScriptedChannel()
    const machinery = new RemoteRewindMachinery({ channel, read: rosterRead })

    const read = await machinery.snapshot({ cuts: [shellCut, agentCut], threadId })

    expect(read).toEqual({
      reachable: true,
      kills: [
        {
          kind: 'shell',
          shellId: 'bash_1',
          command: 'npm test',
          description: 'Run a background job',
          running: true,
        },
        {
          kind: 'agent',
          agentId: toThreadId('thr-child'),
          agentType: 'builder',
          intent: 'Fix the failing test',
          running: true,
        },
      ],
    })
  })

  it('degrades to the cut list with running unknown when the roster cannot be read', async () => {
    const channel = new ScriptedChannel()
    const machinery = new RemoteRewindMachinery({
      channel,
      read: () => Promise.reject(new Error('the socket is closed')),
    })

    const read = await machinery.snapshot({ cuts: [shellCut], threadId })

    expect(read).toEqual({
      reachable: false,
      kills: [
        {
          kind: 'shell',
          shellId: 'bash_1',
          command: 'npm test',
          description: 'Run a background job',
          running: false,
        },
      ],
    })
  })

  it('sends the confirmed cuts to the sandbox on destroy', async () => {
    const channel = new ScriptedChannel()
    const machinery = new RemoteRewindMachinery({ channel, read: rosterRead })

    await machinery.destroy({ cuts: [shellCut, agentCut], threadId })

    expect(channel.applied).toEqual([{ threadId, cuts: [shellCut, agentCut] }])
  })

  it('swallows an apply the sandbox refused, so the rewind write still lands', async () => {
    const channel = new ScriptedChannel()
    channel.failApply = new Error('the sandbox refused the rewind request: unknown op')
    const machinery = new RemoteRewindMachinery({ channel, read: rosterRead })

    await expect(machinery.destroy({ cuts: [shellCut], threadId })).resolves.toBeUndefined()
  })

  it('serializes the cuts for the wire', () => {
    expect(rewindApplyParamsOf({ threadId, cuts: [shellCut, agentCut] })).toEqual({
      threadId: toThreadId('thr-1'),
      cuts: [
        {
          kind: 'shell',
          shellId: 'bash_1',
          command: 'npm test',
          description: 'Run a background job',
        },
        {
          kind: 'agent',
          agentId: toThreadId('thr-child'),
          agentType: 'builder',
          intent: 'Fix the failing test',
        },
      ],
    })
  })
})
