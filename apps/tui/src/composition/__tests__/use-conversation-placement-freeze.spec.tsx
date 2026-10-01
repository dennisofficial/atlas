import { EExecutionLocation, toThreadId } from '@dltech/atlas-core'
import { EPlacementMoveKind, type EventDraft } from '@dltech/atlas-harness'
import { testRender } from '@opentui/react/test-utils'
import { afterEach, describe, expect, it } from 'bun:test'
import React from 'react'

import { SHIPPED_THINKING } from '../../store'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { dismissNotice } from '../../ui/notice-store'
import { EOpenMode } from '../config'
import type { OpenedConversation } from '../open-conversation'
import { useConversation, type Conversation } from '../use-conversation'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

const THREAD = toThreadId('conversation-placement-freeze')
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

describe('a conversation whose placement is mid-move', () => {
  it('freezes retry, resume, send, and take-back until the move settles', async () => {
    const app = fakeApp({
      model: scriptedModelPort({ script: { thinking: '', reply: 'done' } }),
      open: { mode: EOpenMode.New },
    })
    await app.log.append({
      threadId: THREAD,
      drafts: [{ type: 'user-said', text: 'finish the work' }],
    })
    const original = await app.log.read({ threadId: THREAD })
    const writes: EventDraft[][] = []
    app.log.append = async ({ drafts }) => {
      writes.push([...drafts])
      return []
    }
    const opened: OpenedConversation = {
      threadId: THREAD,
      events: original,
      turns: [],
      name: null,
      started: true,
      executionLocation: EExecutionLocation.Host,
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

      expect(conversation.handleSend({ text: 'before the move' })).toBeUndefined()
      await conversation.whenSettled()
      await setup.flush()
      expect(writes.length).toBeGreaterThan(0)
      writes.length = 0
      app.pending.forThread({ threadId: THREAD }).enqueue({ text: 'queued while idle' })

      let release: () => void = () => undefined
      const waiting = new Promise<void>((resolve) => {
        release = resolve
      })
      const moving = app.executionLocation.move({
        threadId: THREAD,
        target: EExecutionLocation.Cloud,
        kind: EPlacementMoveKind.Lift,
        work: async () => {
          await waiting
          throw new Error('stop short of committing — the thread stays on the host')
        },
      })
      await setup.flush()

      expect(app.executionLocation.moveFor(THREAD)).not.toBeNull()
      expect(probe.conversation?.handleRetry).toBeNull()
      expect(probe.conversation?.handleResume).toBeNull()
      probe.conversation?.handleSend({ text: 'during the move' })
      expect(writes).toEqual([])
      expect(probe.conversation?.handleTakeBackPending()).toBeNull()
      await probe.conversation?.whenSettled()
      expect(await app.log.read({ threadId: THREAD })).toEqual(original)

      release()
      await expect(moving).rejects.toThrow('stop short')
      await probe.conversation?.whenSettled()
      await setup.flush()

      expect(app.executionLocation.moveFor(THREAD)).toBeNull()
      expect(probe.conversation?.handleTakeBackPending()?.text).toBe('queued while idle')
    } finally {
      await teardown(setup)
    }
  })
})
