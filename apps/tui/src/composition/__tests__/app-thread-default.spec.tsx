import { ESettingId, refKey, toThreadId } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import type { OpenedConversation } from '../open-conversation'
import { open, until, REPLY } from './app-fixture'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

await grammarsReady()

const THREAD = toThreadId('opened-thread')

const WITHIN_MS = 20_000

const UNSTARTED: OpenedConversation = {
  threadId: THREAD,
  events: [],
  turns: [],
  name: null,
  started: false,
}

const speaking = (): FakeApp =>
  fakeApp({ model: scriptedModelPort({ script: { thinking: 'weighing it', reply: REPLY } }) })

const choiceIn = (app: FakeApp): string => refKey(app.model.choice().ref)

const pickDefault = (args: { app: FakeApp; ref: string }): void => {
  args.app.settings.set({ id: ESettingId.ModelId, value: args.ref })
}

describe('a conversation adopted before the default model is picked', () => {
  it('follows the pick while nobody has spoken yet', async () => {
    const mounted = await open({ app: speaking(), opened: UNSTARTED })

    try {
      expect(choiceIn(mounted.app)).toBe('anthropic/claude-haiku-4-5')

      pickDefault({ app: mounted.app, ref: 'anthropic/claude-sonnet-5' })

      const followed = await until({
        holds: async () => choiceIn(mounted.app) === 'anthropic/claude-sonnet-5',
        within: WITHIN_MS,
      })
      expect(followed).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('starts the first turn on the followed default rather than the launch fallback', async () => {
    const mounted = await open({ app: speaking(), opened: UNSTARTED })

    try {
      pickDefault({ app: mounted.app, ref: 'anthropic/claude-sonnet-5' })
      await until({
        holds: async () => choiceIn(mounted.app) === 'anthropic/claude-sonnet-5',
        within: WITHIN_MS,
      })

      await mounted.typeText('take the linter to zero')
      mounted.pressEnter()
      await until({
        holds: async () => (await mounted.frame()).includes(REPLY),
        within: WITHIN_MS,
      })

      const chosen = mounted.app.threads.chosenModels.map((held) => held.model.ref)
      expect(chosen).toContain('anthropic/claude-sonnet-5')
      expect(chosen).not.toContain('anthropic/claude-haiku-4-5')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('keeps an explicit switch made on the conversation when the default moves', async () => {
    const mounted = await open({ app: speaking(), opened: UNSTARTED })

    try {
      mounted.pressCtrl('p')
      await mounted.frame()
      mounted.pressUp()
      await mounted.frame()
      mounted.pressEnter()
      await mounted.frame()

      expect(choiceIn(mounted.app)).toBe('anthropic/claude-sonnet-5')

      pickDefault({ app: mounted.app, ref: 'anthropic/claude-opus-5' })
      await mounted.frame()

      expect(choiceIn(mounted.app)).toBe('anthropic/claude-sonnet-5')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('keeps the model of a conversation that has already started', async () => {
    const mounted = await open({ app: speaking() })

    try {
      expect(choiceIn(mounted.app)).toBe('anthropic/claude-haiku-4-5')

      pickDefault({ app: mounted.app, ref: 'anthropic/claude-sonnet-5' })
      await mounted.frame()

      expect(choiceIn(mounted.app)).toBe('anthropic/claude-haiku-4-5')
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
