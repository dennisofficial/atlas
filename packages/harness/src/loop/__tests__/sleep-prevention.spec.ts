import { afterEach, describe, expect, it } from 'bun:test'

import { defaultPipeline, EMPTY_PROMPT } from '@dltech/atlas-core'

import { buildHarness, ETurnStatus, LoopTurnRunner, type AtlasHarness } from '..'
import { scriptedModel, type ScriptedStep } from '../../model/testing/scripted-model'
import { SleepPrevention } from '../../power/sleep-prevention'
import { createTempHome, type TempHome } from './temp-home'

const PROJECT_DIRECTORY = '/w'

const opened: { harness: AtlasHarness; temp: TempHome }[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) {
    await entry.harness.close()
    entry.temp.discard()
  }
})

function countingPrevention(): SleepPrevention & { held: number; acquisitions: number } {
  const counts = { held: 0, acquisitions: 0 }
  const prevention = new SleepPrevention({ platform: 'linux' })
  prevention.acquire = () => {
    counts.held += 1
    counts.acquisitions += 1
    return () => {
      counts.held -= 1
    }
  }
  Object.defineProperty(prevention, 'held', { get: () => counts.held })
  Object.defineProperty(prevention, 'acquisitions', { get: () => counts.acquisitions })
  return prevention as SleepPrevention & { held: number; acquisitions: number }
}

async function openHarness(script: readonly ScriptedStep[]): Promise<AtlasHarness> {
  const temp = createTempHome()
  const harness = await buildHarness({ home: temp.home, model: scriptedModel({ script }) })
  opened.push({ harness, temp })
  return harness
}

function runnerWith(args: {
  harness: AtlasHarness
  prevention: SleepPrevention & { held: number; acquisitions: number }
  model?: AtlasHarness['model']
}): LoopTurnRunner {
  return new LoopTurnRunner({
    log: args.harness.log,
    model: args.model ?? args.harness.model,
    ids: args.harness.ids,
    assembly: defaultPipeline({ prompt: () => EMPTY_PROMPT, launchDirectory: PROJECT_DIRECTORY }),
    sleepPrevention: args.prevention,
  })
}

describe('a turn holds a sleep assertion', () => {
  it('acquires for the turn and releases when it completes', async () => {
    const harness = await openHarness([{ text: 'auth and the router' }])
    const prevention = countingPrevention()
    const thread = await harness.threads.create({})

    const outcome = await runnerWith({ harness, prevention }).say({
      threadId: thread.id,
      text: 'what changed?',
    })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    expect(prevention.acquisitions).toBe(1)
    expect(prevention.held).toBe(0)
  })

  it('releases even when the loop throws', async () => {
    const harness = await openHarness([{ text: 'never reached' }])
    const prevention = countingPrevention()
    const runner = runnerWith({
      harness,
      prevention,
      model: {
        identity: harness.model.identity,
        step: async () => {
          throw new Error('the loop threw')
        },
      },
    })
    const thread = await harness.threads.create({})

    await expect(runner.say({ threadId: thread.id, text: 'what changed?' })).rejects.toThrow(
      'the loop threw',
    )
    expect(prevention.held).toBe(0)
  })

  it('drops the lease between turns, so a turn parked for a human holds nothing', async () => {
    const harness = await openHarness([{ text: 'first' }, { text: 'second' }])
    const prevention = countingPrevention()
    const runner = runnerWith({ harness, prevention })
    const thread = await harness.threads.create({})

    await runner.say({ threadId: thread.id, text: 'one' })
    expect(prevention.held).toBe(0)
    await runner.say({ threadId: thread.id, text: 'two' })

    expect(prevention.acquisitions).toBe(2)
    expect(prevention.held).toBe(0)
  })
})
