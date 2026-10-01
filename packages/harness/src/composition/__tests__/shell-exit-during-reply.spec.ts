import { expect, it } from 'bun:test'

import {
  ClockPort,
  defaultPipeline,
  EMPTY_PROMPT,
  EventLogPort,
  IdPort,
  type Event,
  type ModelPort,
} from '@dltech/atlas-core'

import { createDeltaChannel, PublishingTurnRunner } from '../../channel'
import { createIsolatedContainer, portToken } from '../../container/injection'
import { DeltaChannelToken, HookChainToken, WorkspaceRoot } from '../../container/tokens'
import { HookChain } from '../../hooks/registry'
import { MessageIntake } from '../../intake/message-intake'
import { buildHarness, ETurnStatus } from '../../loop'
import { createTempHome } from '../../loop/__tests__/temp-home'
import { scriptedModel } from '../../model/testing/scripted-model'
import { registerShells } from '../../shells/register-shells'
import { ShellRegistryPort } from '../../shells/shell-registry'

it('answers a real shell ending during a model reply without replacing its live stream', async () => {
  const temp = createTempHome()
  const model = scriptedModel({
    script: [{ text: 'waiting for the build' }, { text: 'received the build result' }],
  })
  const harness = await buildHarness({ home: temp.home, model })
  const owner = await harness.threads.create({})
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
    }],
  })
  let launched = false
  let inFlightPreserved = false
  let readAtPublication: Promise<Event[]> | undefined
  const responding: ModelPort = {
    identity: harness.model.identity,
    step: async (args) => {
      const result = await harness.model.step(args)
      if (launched) return result
      launched = true
      const inFlight = channel.snapshot({ threadId: owner.id })
      const published = Promise.withResolvers<void>()
      const unsubscribe = channel.subscribe({
        threadId: owner.id,
        listener: (signal) => {
          if (signal.type !== 'events-appended') return
          inFlightPreserved = channel.snapshot({ threadId: owner.id }) === inFlight
          readAtPublication = harness.log.read({ threadId: owner.id })
          published.resolve()
        },
      })
      const started = shells.start({
        threadId: owner.id,
        command: "printf 'build failed'; exit 7",
        description: 'Build during a reply',
      })
      if (!started.ok) throw new Error(started.reason)
      await published.promise
      unsubscribe()
      return result
    },
  }
  const runner = new PublishingTurnRunner({
    channel,
    deps: {
      log: harness.log,
      ids: harness.ids,
      model: responding,
      assembly: defaultPipeline({ prompt: () => EMPTY_PROMPT, launchDirectory: temp.home }),
      drainPending: (request) => intake.prepare(request),
    },
  })

  try {
    const outcome = await runner.say({ threadId: owner.id, text: 'run the build' })
    const events = await harness.log.read({ threadId: owner.id })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    expect(inFlightPreserved).toBe(true)
    expect((await readAtPublication)?.at(-1)).toMatchObject({
      type: 'background-shell-ended', exitCode: 7, output: 'build failed',
    })
    expect(model.doStreamCalls).toHaveLength(2)
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain('build failed')
    expect(events.filter((event) => event.type === 'background-shell-ended')).toHaveLength(1)
    expect(events.filter((event) => event.type === 'user-said')).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({
      type: 'assistant-said', parts: [{ type: 'text', text: 'received the build result' }],
    })
    expect(shells.pendingNotices({ threadId: owner.id })).toEqual([])
  } finally {
    intake.dispose()
    await shells.closeAll()
    await harness.close()
    temp.discard()
  }
})
