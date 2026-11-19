import { beforeEach, describe, expect, it } from 'bun:test'
import { ControlPlane, type ControlTx } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import {
  chainEvents,
  EAgentStart,
  EAgentStatus,
  EFinishReason,
  ERunFailureKind,
  toCallId,
  toRunId,
  toThreadId,
  type V2Body,
} from '@dltech/atlas-core'
import { ProductAnalytics } from '@dltech/atlas-observability'

import { analyticsAppendHook } from './append-hook'

const NOW = '2026-11-19T12:00:00.000Z'
const SESSION = 'session-1'
const THREAD = 'thread-1'
const USER = 'user-1'
const PROJECT = 'proj-1'
const HOST = 9001

type Captured = { userId: string; event: string; properties: Record<string, unknown> }

class FakeAnalytics extends ProductAnalytics {
  readonly captured: Captured[] = []
  fail = false

  capture(args: { userId: string; event: string; properties?: Record<string, unknown> }): void {
    if (this.fail) throw new Error('capture failed')
    this.captured.push({
      userId: args.userId,
      event: args.event,
      ...{ properties: args.properties ?? {} },
    })
  }

  async flush(): Promise<void> {}
}

class CountingStore extends InMemoryControlStore {
  reads = 0

  override transact<T>(work: (tx: ControlTx) => Promise<T>): Promise<T> {
    return super.transact((tx) =>
      work(
        new Proxy(tx, {
          get: (target, property) => {
            if (property === 'readSession') {
              return (params: { sessionId: string }) => {
                this.reads += 1
                return target.readSession(params)
              }
            }
            const value = Reflect.get(target, property)
            return typeof value === 'function' ? value.bind(target) : value
          },
        }),
      ),
    )
  }
}

const setup = () => {
  const analytics = new FakeAnalytics()
  const store = new CountingStore({ clock: () => NOW })
  store.markHostPresent(HOST)
  const plane = new ControlPlane({ store, appendHooks: [analyticsAppendHook(analytics)] })
  return { analytics, store, plane }
}

const seed = async (plane: ControlPlane): Promise<number> => {
  await plane.createSession({
    sessionId: SESSION,
    userId: USER,
    projectId: PROJECT,
    mainThreadId: THREAD,
  })
  const lease = await plane.grant({ sessionId: SESSION, hostId: HOST })
  return lease.epoch
}

const append = async (plane: ControlPlane, epoch: number, bodies: readonly V2Body[]) => {
  const outcome = await plane.append({
    threadId: THREAD,
    epoch,
    events: chainEvents({
      threadId: toThreadId(THREAD),
      runId: toRunId('run-1'),
      epoch,
      at: NOW,
      bodies,
      from: await plane.head({ threadId: THREAD }),
    }),
  })
  if (!outcome.ok) throw new Error(`append refused: ${JSON.stringify(outcome.refusal)}`)
  return outcome
}

describe('analytics append hook', () => {
  let analytics: FakeAnalytics
  let store: CountingStore
  let plane: ControlPlane

  beforeEach(() => {
    ;({ analytics, store, plane } = setup())
  })

  it('maps input-posted to message_posted', async () => {
    const epoch = await seed(plane)
    const { inboxId } = await plane.post({
      sessionId: SESSION,
      kind: 'message',
      payload: JSON.stringify({ text: 'hi', via: 'operator' }),
    })
    await append(plane, epoch, [
      {
        type: 'input-posted',
        inboxId,
        kind: 'message',
        postedAt: NOW,
        attachments: [],
      },
    ])

    expect(analytics.captured).toEqual([
      {
        userId: USER,
        event: 'message_posted',
        properties: {
          session_id: SESSION,
          project_id: PROJECT,
          has_attachments: false,
          kind: 'message',
        },
      },
    ])
  })

  it('maps a turn-ending assistant-said to turn_completed', async () => {
    const epoch = await seed(plane)
    await append(plane, epoch, [
      {
        type: 'assistant-said',
        parts: [],
        finish: EFinishReason.Stop,
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 2,
          cacheWriteTokens: 1,
          providerId: 'anthropic',
          modelId: 'claude',
        },
      },
    ])

    expect(analytics.captured[0]).toMatchObject({
      event: 'turn_completed',
      properties: {
        session_id: SESSION,
        finish: EFinishReason.Stop,
        provider_id: 'anthropic',
        model_id: 'claude',
        input_tokens: 10,
        output_tokens: 5,
        cache_read_tokens: 2,
        cache_write_tokens: 1,
      },
    })
  })

  it('does not report a tool-call assistant step as a finished turn', async () => {
    const epoch = await seed(plane)
    await append(plane, epoch, [
      { type: 'assistant-said', parts: [], finish: EFinishReason.ToolCalls },
    ])

    expect(analytics.captured).toEqual([])
  })

  it('maps failures, denials, agents and pull requests', async () => {
    const epoch = await seed(plane)
    await append(plane, epoch, [
      {
        type: 'run-failed',
        failure: {
          kind: ERunFailureKind.Auth,
          message: 'secret text',
          statusCode: 401,
          providerId: 'anthropic',
          modelId: 'claude',
        },
      },
      { type: 'tool-denied', callId: toCallId('call-1'), name: 'bash', reason: 'denied' },
      {
        type: 'agent-spawned',
        agentId: toThreadId('agent-1'),
        agentType: 'mate',
        intent: 'do a thing',
        mode: EAgentStart.Fresh,
      },
      {
        type: 'agent-ended',
        agentId: toThreadId('agent-1'),
        agentType: 'mate',
        intent: 'do a thing',
        status: EAgentStatus.Finished,
        prose: 'done',
        turns: 2,
        toolCalls: 3,
      },
      {
        type: 'pull-request-linked',
        number: 7,
        url: 'https://github.com/o/r/pull/7',
        repo: 'o/r',
        branch: 'b',
      },
    ])

    expect(analytics.captured.map((entry) => entry.event)).toEqual([
      'turn_failed',
      'tool_denied',
      'agent_spawned',
      'agent_ended',
      'pull_request_linked',
    ])
    expect(analytics.captured[0]?.properties).toMatchObject({
      kind: ERunFailureKind.Auth,
      status_code: 401,
      provider_id: 'anthropic',
      model_id: 'claude',
    })
    expect(JSON.stringify(analytics.captured)).not.toContain('secret text')
  })

  it('never throws when capture throws', async () => {
    analytics.fail = true
    const epoch = await seed(plane)
    await expect(
      append(plane, epoch, [
        { type: 'tool-denied', callId: toCallId('call-1'), name: 'bash', reason: 'no' },
      ]),
    ).resolves.toBeDefined()
    expect((await plane.head({ threadId: THREAD })).seq).toBe(1)
  })

  it('reads the session once for several events in one append', async () => {
    const epoch = await seed(plane)
    store.reads = 0
    await append(plane, epoch, [
      { type: 'tool-denied', callId: toCallId('call-1'), name: 'bash', reason: 'no' },
      { type: 'tool-denied', callId: toCallId('call-2'), name: 'edit', reason: 'no' },
    ])

    // One read refreshes the session view inside the append; the hook adds exactly one more.
    expect(analytics.captured).toHaveLength(2)
    expect(store.reads).toBe(2)
  })
})
