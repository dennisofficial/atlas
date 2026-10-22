import { afterEach, describe, expect, it } from 'bun:test'

import { defaultPipeline, EMPTY_PROMPT, EShellStatus, type EventDraft, type ModelPort } from '@dltech/atlas-core'

import { buildHarness, ETurnStatus, LoopTurnRunner, type AtlasHarness } from '..'
import { scriptedModel } from '../../model/testing/scripted-model'
import { createTempHome, type TempHome } from './temp-home'

const opened: { harness: AtlasHarness; temp: TempHome }[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) {
    await entry.harness.close()
    entry.temp.discard()
  }
})

const ending: EventDraft = {
  type: 'background-shell-ended',
  shellId: 'bash_1',
  command: 'bun run build',
  status: EShellStatus.Exited,
  exitCode: 1,
  output: 'build failed',
  droppedCharacters: 0,
  remainingCharacters: 0,
}

async function openTurn() {
  const temp = createTempHome()
  const model = scriptedModel({
    script: [{ text: 'waiting for the build' }, { text: 'the build failed; rerunning' }],
  })
  const harness = await buildHarness({ home: temp.home, model })
  opened.push({ harness, temp })
  const thread = await harness.threads.create({})
  return { harness, thread, model }
}

function assembly() {
  return defaultPipeline({ prompt: () => EMPTY_PROMPT, launchDirectory: '/w' })
}

describe('input already written into the durable log', () => {
  it('answers a pending ending on the wake after an interrupted reply', async () => {
    const { harness, thread, model } = await openTurn()
    const controller = new AbortController()
    let delivered = false
    let queued = false
    const responding: ModelPort = {
      identity: harness.model.identity,
      step: async (args) => {
        const result = await harness.model.step(args)
        if (!delivered) {
          delivered = true
          await harness.log.append({
            threadId: thread.id,
            runId: harness.ids.nextRunId(),
            drafts: [ending],
          })
          queued = true
          controller.abort()
        }
        return result
      },
    }
    const runner = new LoopTurnRunner({
      log: harness.log,
      ids: harness.ids,
      model: responding,
      assembly: assembly(),
      drainPending: async () => {
        const wakesTurn = queued
        queued = false
        return { drafts: [], wakesTurn }
      },
    })

    const interrupted = await runner.say({
      threadId: thread.id, text: 'run the build', signal: controller.signal,
    })
    expect(interrupted.status).toBe(ETurnStatus.Interrupted)

    const outcome = await runner.runTurn({ threadId: thread.id })
    expect(outcome.status).toBe(ETurnStatus.Completed)
    expect(model.doStreamCalls).toHaveLength(2)
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain('build failed')
  })

  it('answers an ending that arrives while the model is responding', async () => {
    const { harness, thread, model } = await openTurn()
    let delivered = false
    const responding: ModelPort = {
      identity: harness.model.identity,
      step: async (args) => {
        const result = await harness.model.step(args)
        if (!delivered) {
          delivered = true
          await harness.log.append({
            threadId: thread.id,
            runId: harness.ids.nextRunId(),
            drafts: [ending],
          })
        }
        return result
      },
    }
    const runner = new LoopTurnRunner({
      log: harness.log,
      ids: harness.ids,
      model: responding,
      assembly: assembly(),
    })

    const outcome = await runner.say({ threadId: thread.id, text: 'run the build' })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    expect(model.doStreamCalls).toHaveLength(2)
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain('build failed')
  })

  it('rereads an idle thread when a draft-free wake arrives after its initial read', async () => {
    const { harness, thread, model } = await openTurn()
    await harness.log.append({
      threadId: thread.id,
      runId: harness.ids.nextRunId(),
      drafts: [
        { type: 'user-said', text: 'run the build' },
        { type: 'assistant-said', parts: [{ type: 'text', text: 'waiting for the build' }] },
      ],
    })
    let queued = true
    const runner = new LoopTurnRunner({
      log: harness.log,
      ids: harness.ids,
      model: harness.model,
      assembly: assembly(),
      drainPending: async () => {
        if (!queued) return { drafts: [], wakesTurn: false }
        queued = false
        await harness.log.append({
          threadId: thread.id,
          runId: harness.ids.nextRunId(),
          drafts: [ending],
        })
        return { drafts: [], wakesTurn: true }
      },
    })

    const outcome = await runner.runTurn({ threadId: thread.id })
    const events = await harness.log.read({ threadId: thread.id })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    expect(model.doStreamCalls).toHaveLength(1)
    expect(events.filter((event) => event.type === 'background-shell-ended')).toHaveLength(1)
    expect(events.at(-1)?.type).toBe('assistant-said')
  })

  it('continues after a final answer when a draft-free wake arrives during the final drain', async () => {
    const { harness, thread, model } = await openTurn()
    let drains = 0
    let acknowledgements = 0
    const runner = new LoopTurnRunner({
      log: harness.log,
      ids: harness.ids,
      model: harness.model,
      assembly: assembly(),
      drainPending: async () => {
        drains += 1
        if (drains !== 2) return { drafts: [], wakesTurn: false }
        await harness.log.append({
          threadId: thread.id,
          runId: harness.ids.nextRunId(),
          drafts: [ending],
        })
        return {
          drafts: [],
          wakesTurn: true,
          acknowledge: () => { acknowledgements += 1 },
        }
      },
    })

    const outcome = await runner.say({ threadId: thread.id, text: 'run the build' })
    const events = await harness.log.read({ threadId: thread.id })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    expect(model.doStreamCalls).toHaveLength(2)
    expect(acknowledgements).toBe(1)
    expect(events.filter((event) => event.type === 'background-shell-ended')).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({
      type: 'assistant-said',
      parts: [{ type: 'text', text: 'the build failed; rerunning' }],
    })
  })
})
