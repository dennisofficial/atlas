import { describe, expect, it } from 'bun:test'

import {
  ENoticeTone,
  NoticePort,
  toThreadId,
  type NoticePost,
  type RewindCut,
  type ThreadId,
} from '@dltech/atlas-core'

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

class RecordingNotice extends NoticePort {
  readonly posts: NoticePost[] = []

  notify(post: NoticePost): void {
    this.posts.push(post)
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

  it('warns with the cut names when the sandbox refuses the apply, and the rewind write still lands', async () => {
    const channel = new ScriptedChannel()
    channel.failApply = new Error('the sandbox refused the rewind request: unknown op')
    const notice = new RecordingNotice()
    const machinery = new RemoteRewindMachinery({ channel, read: rosterRead, notice })

    await expect(
      machinery.destroy({ cuts: [shellCut, agentCut], threadId }),
    ).resolves.toBeUndefined()

    expect(notice.posts).toHaveLength(1)
    expect(notice.posts[0]).toMatchObject({
      key: 'cloud:rewind-apply',
      tone: ENoticeTone.Warn,
    })
    expect(notice.posts[0]?.text).toContain('bash_1')
    expect(notice.posts[0]?.text).toContain('builder')
    expect(notice.posts[0]?.text).toContain('unknown op')
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
