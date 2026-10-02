import { EExecutionLocation, toThreadId } from '@dltech/atlas-core'
import { EChannelConnection } from '@dltech/atlas-harness'
import { testRender } from '@opentui/react/test-utils'
import { afterEach, describe, expect, it } from 'bun:test'
import React, { act } from 'react'

import { SHIPPED_THINKING } from '../../store'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { dismissNotice } from '../../ui/notice-store'
import { channelTakingTurns } from '../cloud/channel-ready'
import { EOpenMode } from '../config'
import type { OpenedConversation } from '../open-conversation'
import { useConversation, type Conversation } from '../use-conversation'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

const THREAD = toThreadId('conversation-channel-ready')
type Probe = { conversation: Conversation | null }

function ConversationProbe(props: {
  app: FakeApp
  opened: OpenedConversation
  probe: Probe
  channelReady?: boolean | undefined
}): React.ReactNode {
  props.probe.conversation = useConversation({
    app: props.app,
    opened: props.opened,
    paceReveal: false,
    thinking: SHIPPED_THINKING,
    tldrStatus: false,
    onUndone: () => undefined,
    canWake: false,
    ...(props.channelReady === undefined ? {} : { channelReady: props.channelReady }),
  })
  return <text>probe</text>
}

afterEach(() => dismissNotice())

describe('a conversation whose cloud channel is down', () => {
  it('offers retry for a failed turn while the channel is ready', async () => {
    const app = fakeApp({
      model: scriptedModelPort({ script: { thinking: '', reply: 'done' } }),
      open: { mode: EOpenMode.New },
    })
    const opened: OpenedConversation = {
      threadId: THREAD,
      events: [],
      turns: [],
      name: null,
      started: true,
      executionLocation: EExecutionLocation.Cloud,
    }
    const probe: Probe = { conversation: null }
    const setup = await testRender(
      <ConversationProbe app={app} opened={opened} probe={probe} />,
      { width: 80, height: 8 },
    )
    try {
      await setup.flush()
      const conversation = probe.conversation
      if (conversation === null) throw new Error('the conversation probe never mounted')

      await act(async () => {
        conversation.handleReportProblem('the provider timed out')
      })
      await setup.flush()

      expect(probe.conversation?.model.failure).not.toBeNull()
      expect(probe.conversation?.handleRetry).not.toBeNull()
    } finally {
      await teardown(setup)
    }
  })

  it('suppresses retry and resume until the channel is back', async () => {
    const app = fakeApp({
      model: scriptedModelPort({ script: { thinking: '', reply: 'done' } }),
      open: { mode: EOpenMode.New },
    })
    const opened: OpenedConversation = {
      threadId: THREAD,
      events: [],
      turns: [],
      name: null,
      started: true,
      executionLocation: EExecutionLocation.Cloud,
    }
    const probe: Probe = { conversation: null }
    const setup = await testRender(
      <ConversationProbe app={app} opened={opened} probe={probe} channelReady={false} />,
      { width: 80, height: 8 },
    )
    try {
      await setup.flush()
      const conversation = probe.conversation
      if (conversation === null) throw new Error('the conversation probe never mounted')

      await act(async () => {
        conversation.handleReportProblem('the sandbox socket is down')
      })
      await setup.flush()

      expect(probe.conversation?.model.failure).not.toBeNull()
      expect(probe.conversation?.handleRetry).toBeNull()
      expect(probe.conversation?.handleResume).toBeNull()
    } finally {
      await teardown(setup)
    }
  })
})

describe.each([
  { name: 'no cloud session at all (local)', connection: undefined, ready: true },
  { name: 'open', connection: { state: EChannelConnection.Open, detail: null }, ready: true },
  { name: 'parked, which wakes on demand', connection: { state: EChannelConnection.Parked, detail: null }, ready: true },
  { name: 'closed', connection: { state: EChannelConnection.Closed, detail: null }, ready: false },
  { name: 'connecting', connection: { state: EChannelConnection.Connecting, detail: null }, ready: false },
  { name: 'reconnecting', connection: { state: EChannelConnection.Reconnecting, detail: null }, ready: false },
  { name: 'reattaching', connection: { state: EChannelConnection.Reattaching, detail: null }, ready: false },
  { name: 'waking', connection: { state: EChannelConnection.Waking, detail: null }, ready: false },
])('a channel that is $name', ({ connection, ready }) => {
  it(`takes turns: ${ready}`, () => {
    expect(channelTakingTurns(connection)).toBe(ready)
  })
})
