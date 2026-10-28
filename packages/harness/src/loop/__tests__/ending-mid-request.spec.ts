import { afterEach, describe, expect, it } from 'bun:test'

import { defaultPipeline, EMPTY_PROMPT, type ModelPort, type ThreadId } from '@dltech/atlas-core'

import { buildHarness, ETurnStatus, LoopTurnRunner, type AtlasHarness } from '..'
import {
  agentTypeNamed,
  fakeRunners,
  finished,
  type FakeRunners,
} from '../../agents/registry/__tests__/fixtures'
import { AgentSupervisor } from '../../agents/registry/supervisor'
import { scriptedModel } from '../../model/testing/scripted-model'
import { createTempHome, type TempHome } from './temp-home'
import { userTexts } from './steerable-turn'

const opened: { harness: AtlasHarness; temp: TempHome }[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) {
    await entry.harness.close()
    entry.temp.discard()
  }
})

type Family = {
  harness: AtlasHarness
  model: ReturnType<typeof scriptedModel>
  supervisor: AgentSupervisor
  runners: FakeRunners
  parent: ThreadId
}

async function openFamily(): Promise<Family> {
  const temp = createTempHome()
  const model = scriptedModel({
    script: [
      { text: 'still waiting on the sidebar explorer' },
      { text: 'both explorers are back' },
    ],
  })
  const harness = await buildHarness({ home: temp.home, model })
  opened.push({ harness, temp })
  const runners = fakeRunners()
  const supervisor = new AgentSupervisor({
    log: harness.log,
    threads: harness.threads,
    ids: harness.ids,
    clock: harness.clock,
    agentTypes: [agentTypeNamed({ name: 'explore' })],
    runners: runners.source,
    launchDirectory: '/launch',
  })
  const parent = (await harness.threads.create({})).id
  return { harness, model, supervisor, runners, parent }
}

async function spawn(family: Family, intent: string): Promise<void> {
  const outcome = await family.supervisor.spawn({
    threadId: family.parent,
    agentType: 'explore',
    brief: 'map it',
    intent,
  })
  if (!outcome.ok) throw new Error(outcome.reason)
}

function endingDuringFirstStep(args: { family: Family; end: () => Promise<void> }): ModelPort {
  let steps = 0
  return {
    identity: args.family.harness.model.identity,
    step: async (stepArgs) => {
      const result = await args.family.harness.model.step(stepArgs)
      steps += 1
      if (steps === 1) await args.end()
      return result
    },
  }
}

async function runParentWhileSecondEnds(): Promise<{
  family: Family
  status: ETurnStatus
}> {
  const family = await openFamily()
  await family.harness.log.append({
    threadId: family.parent,
    runId: family.harness.ids.nextRunId(),
    drafts: [{ type: 'user-said', text: 'map the notices and the sidebar' }],
  })
  await spawn(family, 'map github notices')
  await spawn(family, 'map sidebar and web')

  family.runners.started[0]?.settle(finished())
  await noticesQueued({ family, count: 1 })

  const runner = new LoopTurnRunner({
    log: family.harness.log,
    ids: family.harness.ids,
    model: endingDuringFirstStep({
      family,
      end: async () => {
        family.runners.started[1]?.settle(finished())
        await family.supervisor.whenChildrenSettled({ threadId: family.parent })
      },
    }),
    assembly: defaultPipeline({ prompt: () => EMPTY_PROMPT, launchDirectory: '/launch' }),
    drainPending: async ({ threadId }) => family.supervisor.prepareNotifications({ threadId }),
  })

  const outcome = await runner.runTurn({ threadId: family.parent })
  return { family, status: outcome.status }
}

async function noticesQueued(args: { family: Family; count: number }): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const queued = args.family.supervisor.pendingNotices({ threadId: args.family.parent })
    if (queued.length >= args.count) return
    await Bun.sleep(5)
  }
  throw new Error(`never saw ${args.count} queued agent notices`)
}

const mentions = (texts: readonly string[], needle: string): boolean =>
  texts.some((text) => text.includes(needle))

describe('a sub-agent that ends while the parent request is in flight', () => {
  it('reaches the next request instead of failing the turn', async () => {
    const { family, status } = await runParentWhileSecondEnds()

    expect(status).toBe(ETurnStatus.Completed)
    expect(family.model.doStreamCalls).toHaveLength(2)
    const second = userTexts(family.model.doStreamCalls[1]?.prompt ?? [])
    expect(mentions(second, 'map sidebar and web')).toBe(true)
  })

  it('reaches the model after the reply that never saw it', async () => {
    const { family } = await runParentWhileSecondEnds()

    const first = userTexts(family.model.doStreamCalls[0]?.prompt ?? [])
    expect(mentions(first, 'map github notices')).toBe(true)
    expect(mentions(first, 'map sidebar and web')).toBe(false)

    const second = family.model.doStreamCalls[1]?.prompt ?? []
    const blindReplyAt = second.findIndex(
      (message) =>
        message.role === 'assistant' &&
        message.content.some(
          (part) => part.type === 'text' && part.text.includes('still waiting on the sidebar'),
        ),
    )
    const lateEndingAt = second.findIndex(
      (message) =>
        message.role === 'user' &&
        message.content.some(
          (part) => part.type === 'text' && part.text.includes('map sidebar and web'),
        ),
    )
    expect(blindReplyAt).toBeGreaterThanOrEqual(0)
    expect(lateEndingAt).toBeGreaterThan(blindReplyAt)
  })

  it('keeps the ending durable in the log from the moment it arrives', async () => {
    const family = await openFamily()
    await spawn(family, 'map github notices')
    family.runners.started[0]?.settle(finished())
    await noticesQueued({ family, count: 1 })

    const events = await family.harness.log.readOwn({ threadId: family.parent })
    expect(events.some((event) => event.type === 'agent-ended')).toBe(true)
  })
})
