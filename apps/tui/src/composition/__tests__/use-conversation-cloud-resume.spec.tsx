import { EExecutionLocation, toRunId, toThreadId, type EventDraft } from '@dltech/atlas-core'
import { EChannelConnection, ETurnStatus, RemoteTurnRunner } from '@dltech/atlas-harness'
import { testRender } from '@opentui/react/test-utils'
import { afterEach, describe, expect, it } from 'bun:test'
import React, { act } from 'react'

import { SHIPPED_THINKING } from '../../store'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { dismissNotice } from '../../ui/notice-store'
import { fakeCloudChannel } from '../cloud/__tests__/fixture'
import { EOpenMode } from '../config'
import type { OpenedConversation } from '../open-conversation'
import { useConversation, type Conversation } from '../use-conversation'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

const THREAD = toThreadId('conversation-cloud-resume')
type Probe = { conversation: Conversation | null }

function ConversationProbe(props: {
  app: FakeApp
  opened: OpenedConversation
  probe: Probe
}): React.ReactNode {
  props.probe.conversation = useConversation({
    app: props.app,
    opened: props.opened,
    paceReveal: false,
    thinking: SHIPPED_THINKING,
    tldrStatus: false,
    onUndone: () => undefined,
    canWake: false,
  })
  return <text>probe</text>
}

afterEach(() => dismissNotice())

describe('a cloud conversation opened during an active turn', () => {
  it('does not automatically resume or offer Resume or Retry while the sandbox is busy', async () => {
    const app = fakeApp({
      model: scriptedModelPort({ script: { thinking: '', reply: 'done' } }),
      open: { mode: EOpenMode.Continue },
    })
    await app.log.append({
      threadId: THREAD,
      runId: toRunId('interrupted-run'),
      drafts: [
        { type: 'user-said', text: 'finish the work' },
        {
          type: 'assistant-said',
          parts: [{ type: 'text', text: 'I was checking' }],
          interrupted: true,
        },
      ],
    })
    const original = await app.log.read({ threadId: THREAD })
    const writes: EventDraft[][] = []
    app.log.append = async ({ drafts }) => {
      writes.push([...drafts])
      throw new Error('the sandbox owns the transcript while lifted')
    }
    const channel = fakeCloudChannel({
      threadId: THREAD,
      connection: { state: EChannelConnection.Open, detail: null },
    })
    channel.snapshot = () => [{ type: 'turn-working', working: true }]
    channel.subscribe = ({ threadId, listener }) => {
      for (const signal of channel.snapshot({ threadId })) listener(signal)
      return () => undefined
    }
    const runs: ({ resume?: boolean } | undefined)[] = []
    channel.run = (args) => {
      runs.push(args)
      queueMicrotask(() =>
        channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('unexpected-run') }),
      )
    }
    Object.assign(app, {
      channel,
      runner: new RemoteTurnRunner({ channel, wake: async () => undefined }),
    })
    channel.ready({ turnInFlight: true })
    const probe: Probe = { conversation: null }
    const setup = await testRender(
      <ConversationProbe
        app={app}
        opened={{
          threadId: THREAD,
          events: original,
          turns: [],
          name: null,
          started: true,
          executionLocation: EExecutionLocation.Cloud,
        }}
        probe={probe}
      />,
      { width: 80, height: 8 },
    )
    try {
      await setup.flush()
      const conversation = probe.conversation
      if (conversation === null) throw new Error('the conversation probe never mounted')
      expect(conversation.turnInFlight()).toBe(true)
      expect(conversation.working).toBe(false)
      expect(conversation.handleResume).toBeNull()
      expect(conversation.handleRetry).toBeNull()
      expect(runs).toEqual([])
      expect(channel.sent).toEqual([])
      expect(writes).toEqual([])
      await act(async () => {
        conversation.handleReportProblem('an earlier turn failed')
      })
      await setup.flush()
      expect(probe.conversation?.model.failure).not.toBeNull()
      expect(probe.conversation?.handleRetry).toBeNull()
      expect(probe.conversation?.handleResume).toBeNull()
      expect(runs).toEqual([])
      expect(channel.sent).toEqual([])
      expect(writes).toEqual([])
      expect(await app.log.read({ threadId: THREAD })).toEqual(original)
    } finally {
      await teardown(setup)
    }
  })
})
