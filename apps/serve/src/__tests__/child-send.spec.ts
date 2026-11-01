import { describe, expect, it } from 'bun:test'
import { EAgentStatus, EMessageOrigin, toRunId, toThreadId } from '@dltech/atlas-core'
import type { AgentSnapshot } from '@dltech/atlas-harness'

import { sayToChild } from '../child-send'

const OWNER = toThreadId('thr-owner')
const CHILD = toThreadId('thr-child')

const settled: AgentSnapshot = {
  agentId: CHILD,
  spawnedBy: OWNER,
  agentType: 'teammate',
  intent: 'review',
  status: EAgentStatus.Stopped,
  turns: 1,
  toolCalls: 0,
  lastTool: undefined,
  startedAt: '2026-11-01T00:00:00.000Z',
  endedAt: '2026-11-01T00:01:00.000Z',
}

const fixture = (args: { sayOk: boolean }) => {
  const said: { threadId: string; agentId: string; text: string }[] = []
  const appended: { threadId: string; drafts: unknown[] }[] = []
  const ran: string[] = []
  const agents = {
    say: async (given: { threadId: string; agentId: string; text: string }) => {
      said.push(given)
      return args.sayOk
        ? { ok: true as const, snapshot: settled }
        : { ok: false as const, reason: 'not stepping' }
    },
    resume: async () => ({ ok: true as const, snapshot: settled }),
    stop: async () => ({ ok: true as const, snapshot: settled }),
    wake: async () => ({ ok: true as const, snapshot: settled }),
  }
  const log = {
    append: async (given: { threadId: string; runId: string; drafts: readonly unknown[] }) => {
      appended.push({ threadId: given.threadId, drafts: [...given.drafts] })
      return []
    },
  }
  const runner = {
    runTurn: async (given: { threadId: string }) => {
      ran.push(given.threadId)
      return { status: 'completed' } as never
    },
  }
  const ids = { nextRunId: () => toRunId('run-1') }
  return { said, appended, ran, agents, log, runner, ids }
}

describe('sayToChild', () => {
  it('steers a stepping child through the registry and appends nothing itself', async () => {
    const test = fixture({ sayOk: true })

    await sayToChild({
      ...test,
      owner: OWNER,
      agentId: CHILD,
      frame: { text: 'keep the commits conventional' },
    })

    expect(test.said).toEqual([
      { threadId: OWNER, agentId: CHILD, text: 'keep the commits conventional' },
    ])
    expect(test.appended).toEqual([])
    expect(test.ran).toEqual([])
  })

  it('appends the message — uploads included — and runs a turn for a settled child', async () => {
    const test = fixture({ sayOk: false })

    await sayToChild({
      ...test,
      owner: OWNER,
      agentId: CHILD,
      frame: {
        text: 'pick this back up',
        requestId: 'req-1',
        uploads: [
          {
            uploadId: '6f1c2b60-3b1a-4f6a-9b7a-2c5c2b9f1a11',
            pathname: '/tmp/upload.zip',
            name: 'upload.zip',
            size: 10,
            mediaType: 'application/zip',
          },
        ],
      },
    })

    expect(test.appended).toEqual([
      {
        threadId: CHILD,
        drafts: [
          {
            type: 'user-said',
            text: 'pick this back up',
            requestId: 'req-1',
            uploads: [
              {
                uploadId: '6f1c2b60-3b1a-4f6a-9b7a-2c5c2b9f1a11',
                pathname: '/tmp/upload.zip',
                name: 'upload.zip',
                size: 10,
                mediaType: 'application/zip',
              },
            ],
            via: EMessageOrigin.Operator,
          },
        ],
      },
    ])
    expect(test.ran).toEqual([CHILD])
  })
})
