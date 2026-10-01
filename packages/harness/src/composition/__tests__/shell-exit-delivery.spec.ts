import { afterEach, describe, expect, it } from 'bun:test'

import {
  ClockPort,
  defaultPipeline,
  EMPTY_PROMPT,
  EventLogPort,
  IdPort,
  type Event,
} from '@dltech/atlas-core'

import { createDeltaChannel, PublishingTurnRunner, type ChannelSignal } from '../../channel'
import { createIsolatedContainer, portToken } from '../../container/injection'
import { DeltaChannelToken, HookChainToken, WorkspaceRoot } from '../../container/tokens'
import { HookChain } from '../../hooks/registry'
import { MessageIntake } from '../../intake/message-intake'
import { buildHarness, ETurnStatus, type TurnOutcome } from '../../loop'
import { createTempHome } from '../../loop/__tests__/temp-home'
import { scriptedModel } from '../../model/testing/scripted-model'
import { registerShells } from '../../shells/register-shells'
import { ShellRegistryPort } from '../../shells/shell-registry'

const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function openDelivery() {
  const temp = createTempHome()
  const model = scriptedModel({
    script: [{ text: 'waiting for the build' }, { text: 'received the build result' }],
  })
  const harness = await buildHarness({ home: temp.home, model })
  const owner = await harness.threads.create({})
  const other = await harness.threads.create({})
  const container = createIsolatedContainer()
  container.register(WorkspaceRoot, { useValue: temp.home })
  container.register(portToken(ClockPort), { useValue: harness.clock })
  container.register(portToken(IdPort), { useValue: harness.ids })
  container.register(portToken(EventLogPort), { useValue: harness.log })
  container.register(HookChainToken, { useValue: new HookChain({}) })
  registerShells({ container })
  const shells = container.resolve(portToken(ShellRegistryPort))
  const channel = createDeltaChannel()
  container.register(DeltaChannelToken, { useValue: channel })
  const prepare = shells.prepareNotifications?.bind(shells)
  if (prepare === undefined) throw new Error('shell intake preparation is unavailable')
  const intake = new MessageIntake({
    sources: [{
      prepare,
      subscribe: (listener) => shells.onNotice(listener),
      threadsAwaitingInput: () => shells.threadsAwaitingNotice(),
      witness: (request) => shells.pendingNotices(request),
    }],
  })
  const runner = new PublishingTurnRunner({
    channel,
    deps: {
      log: harness.log,
      ids: harness.ids,
      model: harness.model,
      assembly: defaultPipeline({ prompt: () => EMPTY_PROMPT, launchDirectory: temp.home }),
      drainPending: (request) => intake.prepare(request),
    },
  })
  let blocked = false
  let ownerWakes = 0
  let otherWakes = 0
  const replied = Promise.withResolvers<TurnOutcome>()
  intake.register({
    threadId: owner.id,
    driver: {
      blocked: () => blocked,
      wake: async () => {
        blocked = true
        ownerWakes += 1
        try {
          const outcome = await runner.runTurn({ threadId: owner.id })
          replied.resolve(outcome)
        } catch (error) {
          replied.reject(error)
        } finally {
          blocked = false
          intake.changed()
        }
      },
    },
  })
  intake.register({
    threadId: other.id,
    driver: { blocked: () => false, wake: () => { otherWakes += 1 } },
  })
  cleanups.push(async () => {
    intake.dispose()
    await shells.closeAll()
    await harness.close()
    temp.discard()
  })
  await runner.say({ threadId: owner.id, text: 'run the build' })

  const ownerSignals: ChannelSignal[] = []
  const otherSignals: ChannelSignal[] = []
  let publishedRead: Promise<Event[]> | undefined
  channel.subscribe({
    threadId: owner.id,
    listener: (signal) => {
      ownerSignals.push(signal)
      if (signal.type === 'events-appended' && publishedRead === undefined) {
        publishedRead = harness.log.read({ threadId: owner.id })
      }
    },
  })
  channel.subscribe({ threadId: other.id, listener: (signal) => { otherSignals.push(signal) } })

  return {
    harness, owner, shells, model, ownerSignals, otherSignals,
    replied: replied.promise,
    published: () => publishedRead,
    wakes: () => ({ owner: ownerWakes, other: otherWakes }),
    setBlocked: (value: boolean) => { blocked = value; intake.changed() },
  }
}

describe('background shell completion through shared delivery', () => {
  for (const exitCode of [0, 1]) {
    it(`publishes and answers an idle owner's exit ${exitCode} without operator input`, async () => {
      const delivery = await openDelivery()
      const started = delivery.shells.start({
        threadId: delivery.owner.id,
        command: `printf 'build result'; exit ${exitCode}`,
        description: 'Build result',
      })
      if (!started.ok) throw new Error(started.reason)

      const outcome = await delivery.replied
      const published = await delivery.published()
      const events = await delivery.harness.log.read({ threadId: delivery.owner.id })

      expect(outcome.status).toBe(ETurnStatus.Completed)
      expect(delivery.wakes()).toEqual({ owner: 1, other: 0 })
      expect(delivery.otherSignals).toEqual([])
      expect(delivery.ownerSignals[0]?.type).toBe('events-appended')
      expect(published?.at(-1)).toMatchObject({
        type: 'background-shell-ended',
        shellId: started.snapshot.shellId,
        exitCode,
        output: 'build result',
      })
      expect(events.filter((event) => event.type === 'background-shell-ended')).toHaveLength(1)
      expect(events.filter((event) => event.type === 'user-said')).toHaveLength(1)
      expect(events.at(-1)).toMatchObject({
        type: 'assistant-said',
        parts: [{ type: 'text', text: 'received the build result' }],
      })
      expect(delivery.model.doStreamCalls).toHaveLength(2)
      expect(JSON.stringify(delivery.model.doStreamCalls[1]?.prompt)).toContain('build result')
      expect(delivery.shells.pendingNotices({ threadId: delivery.owner.id })).toEqual([])
    })
  }

  it('publishes while the owner is blocked and wakes it when it becomes idle', async () => {
    const delivery = await openDelivery()
    delivery.setBlocked(true)
    const noticed = Promise.withResolvers<void>()
    const unsubscribe = delivery.shells.onNotice(() => {
      if (delivery.shells.pendingNotices({ threadId: delivery.owner.id }).length > 0) noticed.resolve()
    })
    const started = delivery.shells.start({
      threadId: delivery.owner.id,
      command: 'echo done',
      description: 'Finish while blocked',
    })
    if (!started.ok) throw new Error(started.reason)
    await noticed.promise
    unsubscribe()

    expect(delivery.wakes()).toEqual({ owner: 0, other: 0 })
    expect(delivery.ownerSignals).toEqual([{ type: 'events-appended' }])
    expect((await delivery.published())?.at(-1)?.type).toBe('background-shell-ended')

    delivery.setBlocked(false)
    expect((await delivery.replied).status).toBe(ETurnStatus.Completed)
    expect(delivery.wakes()).toEqual({ owner: 1, other: 0 })
  })
})
