import { afterEach, describe, expect, it } from 'bun:test'

import { defaultPipeline, EMPTY_PROMPT, type ModelPort } from '@dltech/atlas-core'

import { buildHarness, ETurnStatus, LoopTurnRunner, type AtlasHarness } from '..'
import { scriptedModel } from '../../model/testing/scripted-model'
import { endedDraft } from '../../shells/notifications'
import { RandomIds } from '../../store/ids'
import { appendPending } from '../pending-intake'
import type { PendingDrain } from '../run-turn'
import {
  closeRegistries,
  job,
  openRegistry,
  recorded,
  settle,
  THREAD,
} from '../../shells/__tests__/shell-registry-fixture'
import { createTempHome, type TempHome } from './temp-home'

const PROJECT_DIRECTORY = '/w'

const opened: { harness: AtlasHarness; temp: TempHome }[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) {
    await entry.harness.close()
    entry.temp.discard()
  }
  await closeRegistries()
})

async function runEndingAfterFinalMessage(args: { wakesTurn: boolean }): Promise<{
  status: ETurnStatus
  tailType: string | undefined
  modelCalls: number
}> {
  const temp = createTempHome()
  const model = scriptedModel({
    script: [{ text: 'the build will wake me when it finishes' }, { text: 'the build failed; rerunning' }],
  })
  const harness = await buildHarness({ home: temp.home, model })
  opened.push({ harness, temp })
  const thread = await harness.threads.create({})

  let endingQueued = false
  const drainPending = async (): Promise<PendingDrain> => {
    if (!endingQueued) return { drafts: [], wakesTurn: false }
    endingQueued = false
    const drafts = [
      endedDraft({
        snapshot: {
          shellId: 'bash_1',
          command: 'bun run build',
          description: 'Build workspace dependencies',
          status: 'exited',
          exitCode: 1,
          totalCharacters: 0,
        } as never,
        delta: { text: '', droppedCharacters: 0, remainingCharacters: 0 },
      }),
    ]
    return { drafts, wakesTurn: args.wakesTurn }
  }

  let queuedOnce = false
  const steered: ModelPort = {
    identity: harness.model.identity,
    step: async (stepArgs) => {
      const result = await harness.model.step(stepArgs)
      if (!queuedOnce) {
        queuedOnce = true
        endingQueued = true
      }
      return result
    },
  }

  const runner = new LoopTurnRunner({
    log: harness.log,
    model: steered,
    ids: harness.ids,
    assembly: defaultPipeline({
      prompt: () => EMPTY_PROMPT,
      launchDirectory: PROJECT_DIRECTORY,
    }),
    drainPending,
  })

  const outcome = await runner.say({
    threadId: thread.id,
    text: 'run the build',
  })
  const events = await harness.log.read({ threadId: thread.id })

  return {
    status: outcome.status,
    tailType: events.at(-1)?.type,
    modelCalls: model.doStreamCalls.length,
  }
}

describe('a shell ending drained after the final message', () => {
  it('is answered by a further step rather than left at the tail when the drain wakes the turn', async () => {
    const result = await runEndingAfterFinalMessage({ wakesTurn: true })

    expect(result.status).toBe(ETurnStatus.Completed)
    expect(result.tailType).toBe('assistant-said')
    expect(result.modelCalls).toBe(2)
  })
})

describe('an ending the occurrence already wrote', () => {
  it('is not appended a second time when the turn drains the wake-up bell', async () => {
    const { registry, log } = openRegistry()
    const started = registry.start(job({ command: 'echo done' }))
    if (!started.ok) throw new Error(started.reason)

    await settle({ registry, shellId: started.snapshot.shellId })
    await recorded({ log })

    if (log === undefined) throw new Error('the registry opened without a log')

    const drained = await appendPending({
      drain: async ({ threadId }) => {
        const batch = registry.prepareNotifications({ threadId })
        return {
          drafts: batch.drafts,
          wakesTurn: batch.wakesTurn,
          acknowledge: batch.acknowledge,
        }
      },
      log,
      ids: new RandomIds(),
      threadId: THREAD,
    })

    expect(drained.ok && !drained.drained).toBe(true)
    const ended = (await log.read({ threadId: THREAD })).filter(
      (event) => event.type === 'background-shell-ended',
    )
    expect(ended).toHaveLength(1)
  })
})
