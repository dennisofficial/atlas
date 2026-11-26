import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import {
  EMPTY_ANALYTICS,
  EMPTY_CLASSIFIER,
  EMPTY_CREW,
  EMPTY_MCP_CONTROL,
  EMPTY_MESSAGES,
  EMPTY_POD_RESOURCES,
  EMPTY_ROUTINES,
  EMPTY_SESSIONS,
  EMPTY_SUBSCRIPTIONS,
  EMPTY_WORKTREES,
  UNVERSIONED_SETTINGS,
  type MessageSent,
  type PluginPodContext,
  type PodMessages,
} from '@dltech/atlas-plugin-sdk'

import { sessionsPod } from '..'

type Call = { method: string; args: unknown }

const fakeMessages = (sent: MessageSent) => {
  const calls: Call[] = []
  const port: PodMessages = {
    send: async (sendArgs) => {
      calls.push({ method: 'send', args: sendArgs })
      return sent
    },
  }
  return { port, calls }
}

const rig = (messages: PodMessages = EMPTY_MESSAGES) => {
  const ctx: PluginPodContext = {
    sessionId: 's1',
    sessions: EMPTY_SESSIONS,
    resources: EMPTY_POD_RESOURCES,
    crew: EMPTY_CREW,
    messages,
    classifier: EMPTY_CLASSIFIER,
    analytics: EMPTY_ANALYTICS,
    worktrees: EMPTY_WORKTREES,
    notify: async () => undefined,
    control: {
      settingsVersions: async () => UNVERSIONED_SETTINGS,
      exposePort: async () => {
        throw new Error('this rig exposes no port')
      },
      mcp: EMPTY_MCP_CONTROL,
      gateway: { apiKey: async () => undefined, imageModel: async () => undefined },
      routines: EMPTY_ROUTINES,
      subscriptions: EMPTY_SUBSCRIPTIONS,
      memory: {
        list: async () => ({ project: null, group: null, memories: [] }),
        read: async () => null,
        write: async () => {
          throw new Error('this rig writes no memory')
        },
        edit: async () => {
          throw new Error('this rig edits no memory')
        },
        delete: async () => false,
      },
    },
    append: async () => undefined,
    events: () => [],
    call: async () => {
      throw new Error('this rig calls no daemon')
    },
    live: () => undefined,
    onDaemonEvent: () => () => undefined,
    log: () => undefined,
  }
  return { ctx }
}

const invoke = async (args: { ctx: PluginPodContext; input: unknown }) => {
  const tool = sessionsPod.tools?.(args.ctx).find((candidate) => candidate.name === 'send_message')
  if (tool === undefined) throw new Error('no send_message tool')
  return tool.invoke({
    input: args.input,
    signal: new AbortController().signal,
    idempotencyKey: 'k',
    projectDirectory: '/work',
    threadId: toThreadId('t1'),
  })
}

const textOf = (outcome: Awaited<ReturnType<typeof invoke>>): string =>
  outcome.ok ? outcome.modelText : outcome.reason

describe('send_message', () => {
  it('sends to the address and says the message was sent', async () => {
    const messages = fakeMessages({ delivered: true, to: 'p1', queued: false })
    const { ctx } = rig(messages.port)
    const outcome = await invoke({ ctx, input: { to: 'p1', text: 'hello' } })

    expect(messages.calls).toEqual([{ method: 'send', args: { to: 'p1', text: 'hello' } }])
    expect(outcome.ok && outcome.output).toEqual({ to: 'p1', queued: false })
    expect(textOf(outcome)).toBe('Sent to p1.')
  })

  it('names the receiver beside its id when the address has a name', async () => {
    const messages = fakeMessages({
      delivered: true,
      to: 'p1',
      name: 'Lexer rewrite',
      queued: false,
    })
    const { ctx } = rig(messages.port)
    const outcome = await invoke({ ctx, input: { to: 'p1', text: 'hello' } })

    expect(outcome.ok && outcome.output).toEqual({ to: 'p1', name: 'Lexer rewrite', queued: false })
    expect(textOf(outcome)).toBe('Sent to Lexer rewrite (p1).')
  })

  it('says a busy receiver reads the message after its current step', async () => {
    const messages = fakeMessages({ delivered: true, to: 'a1', queued: true })
    const { ctx } = rig(messages.port)
    const outcome = await invoke({ ctx, input: { to: 'a1', text: 'more' } })

    expect(textOf(outcome)).toBe(
      'Sent to a1. It is busy, so it reads the message after its current step.',
    )
  })

  it('turns a refusal into the tool reason and keeps the find-ids hint', async () => {
    const reason =
      'no agent or session nope. Find ids with agent_list, list_sessions or list_teammates.'
    const messages = fakeMessages({ refused: reason })
    const { ctx } = rig(messages.port)
    const outcome = await invoke({ ctx, input: { to: 'nope', text: 'hello' } })

    expect(outcome).toEqual({ ok: false, reason })
  })

  it('is eager, and its description says the message wakes the receiver', () => {
    const { ctx } = rig()
    const tool = sessionsPod.tools?.(ctx).find((candidate) => candidate.name === 'send_message')

    expect((tool as { deferred?: true } | undefined)?.deferred).toBeUndefined()
    expect(tool?.description).toContain('The message wakes the receiver.')
    expect(tool?.description).toContain('"parent"')
    expect(tool?.description).toContain('It cannot reach the operator')
  })
})
