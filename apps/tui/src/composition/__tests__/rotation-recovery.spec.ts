import { describe, expect, it } from 'bun:test'

import { toRunId, toThreadId } from '@dltech/atlas-core'

import { ETurnStatus } from '@dltech/atlas-harness'

import { guardedActivation } from '../rotation-recovery'
import { fakeApp, scriptedModelPort } from './fake-app'

const SUCCESSOR = toThreadId('thr_successor')

const setup = () => {
  const app = fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: 'ok' } }) })
  const started: string[] = []
  app.runner.runTurn = async ({ threadId }) => {
    started.push(threadId)
    return { status: ETurnStatus.Idle, runId: toRunId('spy') }
  }
  return { app, started, log: app.log }
}

describe('the guarded activation handed to recover', () => {
  it('starts the successor turn when nothing has run there yet', async () => {
    const { app, started, log } = setup()
    await log.append({ threadId: SUCCESSOR, runId: toRunId('r'), drafts: [{ type: 'user-said', text: 'seed' }] })

    await guardedActivation({ app, successor: SUCCESSOR, turnInFlight: () => false })()

    expect(started).toEqual([SUCCESSOR])
  })

  it('refuses a second turn while one is in flight', async () => {
    const { app, started } = setup()

    await guardedActivation({ app, successor: SUCCESSOR, turnInFlight: () => true })()

    expect(started).toEqual([])
  })

  it('refuses a second turn once the successor already answered', async () => {
    const { app, started, log } = setup()
    await log.append({
      threadId: SUCCESSOR,
      runId: toRunId('r'),
      drafts: [{ type: 'user-said', text: 'seed' }, { type: 'assistant-said', parts: [], interrupted: false }],
    })

    await guardedActivation({ app, successor: SUCCESSOR, turnInFlight: () => false })()

    expect(started).toEqual([])
  })
})
