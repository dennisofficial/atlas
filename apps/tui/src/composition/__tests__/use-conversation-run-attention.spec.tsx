import { EExecutionLocation, ERunFailureKind, toRunId, toThreadId } from '@dltech/atlas-core'
import type { EventDraft } from '@dltech/atlas-core'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React, { act } from 'react'

import { SHIPPED_THINKING } from '../../store'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { EOpenMode } from '../config'
import type { OpenedConversation } from '../open-conversation'
import { useConversation, type Conversation } from '../use-conversation'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

const THREAD = toThreadId('conversation-run-attention')
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

const FAILED: EventDraft = {
  type: 'run-failed',
  failure: { kind: ERunFailureKind.Auth, message: 'invalid x-api-key', providerId: 'anthropic' },
}

const mount = async (drafts: readonly EventDraft[]) => {
  const app = fakeApp({
    model: scriptedModelPort({ script: { thinking: '', reply: 'done' } }),
    open: { mode: EOpenMode.New },
  })
  const events = await app.log.append({
    threadId: THREAD,
    runId: toRunId('run-1'),
    drafts: [{ type: 'user-said', text: 'go' }, ...drafts],
  })
  const opened: OpenedConversation = {
    threadId: THREAD,
    events,
    turns: [],
    name: null,
    started: true,
    executionLocation: EExecutionLocation.Host,
  }
  const probe: Probe = { conversation: null }
  const setup = await testRender(<ConversationProbe app={app} opened={opened} probe={probe} />, {
    width: 80,
    height: 8,
  })
  await setup.flush()
  return { app, probe, setup }
}

describe('the conversation run attention', () => {
  it('offers retry and a durable close for a run failure', async () => {
    const { probe, setup } = await mount([FAILED])
    try {
      expect(probe.conversation?.attention?.failure?.kind).toBe(ERunFailureKind.Auth)
      expect(probe.conversation?.handleRetry).not.toBeNull()
      expect(probe.conversation?.handleDismissFailure).not.toBeNull()
    } finally {
      await teardown(setup)
    }
  })

  it('dismisses through dismissRunFailure with the failure seq', async () => {
    const { app, probe, setup } = await mount([FAILED])
    try {
      const failureSeq = probe.conversation?.attention?.failureSeq
      expect(failureSeq).toBeGreaterThan(0)
      await act(async () => {
        probe.conversation?.handleDismissFailure?.()
      })
      await setup.flush()
      const log = await app.log.read({ threadId: THREAD })
      expect(log.filter((event) => event.type === 'run-failure-dismissed')).toMatchObject([
        { failureSeq },
      ])
      expect(probe.conversation?.attention?.failure ?? null).toBeNull()
      expect(probe.conversation?.model.failure).toBeNull()
    } finally {
      await teardown(setup)
    }
  })

  it('shows no failure for a log that already holds the dismissal', async () => {
    const { probe, setup } = await mount([FAILED, { type: 'run-failure-dismissed', failureSeq: 2 }])
    try {
      expect(probe.conversation?.attention?.failure ?? null).toBeNull()
      expect(probe.conversation?.model.failure).toBeNull()
      expect(probe.conversation?.handleDismissFailure).toBeNull()
    } finally {
      await teardown(setup)
    }
  })
})
