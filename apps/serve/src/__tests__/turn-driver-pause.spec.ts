import { describe, expect, it } from 'bun:test'
import { toCallId, toRunId, toThreadId } from '@dltech/atlas-core'
import { ETurnStatus, type TurnOutcome } from '@dltech/atlas-harness'

import { createTurnDriver } from '../turn-driver'
import { fakeServeApp } from './fakes'

const threadId = toThreadId('confirmed-family-pause')
const gate = <T>() => {
  let resolve = (_value: T): void => undefined
  let reject = (_reason: Error): void => undefined
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const outcome = (status: ETurnStatus.Completed | ETurnStatus.Idle | ETurnStatus.RelocationPaused): TurnOutcome =>
  ({ status, runId: toRunId('pause-run') })
const fixture = (app = fakeServeApp({ threadId, root: '/workspace' })) => {
  const outcomes: TurnOutcome[] = []
  const failures: string[] = []
  const driver = createTurnDriver({
    app, threadId, onTurnStarted: () => undefined, onTurnEnded: () => undefined,
    onOutcome: (ended) => { outcomes.push(ended) }, onFailure: (reason) => { failures.push(reason) },
  })
  return { app, driver, outcomes, failures }
}

describe('confirmed relocation preparation', () => {
  const settledContexts: TurnOutcome[] = [
    { status: ETurnStatus.Paused, runId: toRunId('approval-run'), callId: toCallId('approval-call'), reason: 'awaiting approval' },
    { status: ETurnStatus.Failed, runId: toRunId('failed-run'), message: 'old failure', cause: null },
    { status: ETurnStatus.Interrupted, runId: toRunId('stopped-run'), committed: true },
  ]
  for (const previous of settledContexts) {
    it(`prepares an idle ${previous.status} context without treating its historical ending as a new failure`, async () => {
      let turns = 0
      let pauses = 0
      const test = fixture(fakeServeApp({
        threadId, root: '/workspace', runTurn: async () => { turns += 1; return previous },
        family: { pauseChildren: async () => { pauses += 1 } },
      }))
      test.driver.run()
      await test.driver.settled()
      await test.driver.beginRelocation()
      expect(pauses).toBe(1)
      expect(test.failures).toEqual([])
      expect(test.outcomes.map((one) => one.status)).toEqual([previous.status, ETurnStatus.RelocationPaused])
      expect(test.driver.relocationResumable()).toBe(false)
      test.driver.resume()
      await Bun.sleep(1)
      expect(turns).toBe(1)
    })
  }

  it('prepares an idle context whose previous turn threw', async () => {
    const test = fixture(fakeServeApp({
      threadId, root: '/workspace', runTurn: async () => { throw new Error('old model crash') },
    }))
    test.driver.run()
    await test.driver.settled()
    expect(test.failures).toEqual(['old model crash'])
    await test.driver.beginRelocation()
    expect(test.outcomes.map((one) => one.status)).toEqual([ETurnStatus.RelocationPaused])
    expect(test.driver.relocationResumable()).toBe(false)
  })

  it('coalesces callers until the parent seam and family persistence have both landed', async () => {
    const parent = gate<TurnOutcome>()
    const children = gate<void>()
    let pauses = 0
    let signal: AbortSignal | undefined
    const test = fixture(fakeServeApp({
      threadId, root: '/workspace',
      runTurn: (args) => { signal = args.signal; return parent.promise },
      family: { pauseChildren: async () => { pauses += 1; await children.promise } },
    }))
    test.driver.run()
    const first = test.driver.beginRelocation()
    expect(test.driver.beginRelocation()).toBe(first)
    parent.resolve(outcome(ETurnStatus.RelocationPaused))
    await Bun.sleep(1)
    expect(pauses).toBe(1)
    expect(test.outcomes).toEqual([])
    expect(signal?.aborted).toBe(false)
    children.resolve()
    await first
    expect(test.outcomes.map((one) => one.status)).toEqual([ETurnStatus.RelocationPaused])
    expect(test.driver.relocationResumable()).toBe(true)
    expect(test.driver.beginRelocation()).toBe(first)
  })

  for (const status of [ETurnStatus.Completed, ETurnStatus.Idle] as const) {
    it(`preserves a natural ${status} before its synthetic pause without reviving the parent`, async () => {
      const parent = gate<TurnOutcome>()
      const children = gate<void>()
      let turns = 0
      let resumes = 0
      const test = fixture(fakeServeApp({
        threadId, root: '/workspace', runTurn: () => { turns += 1; return parent.promise },
        family: {
          pauseChildren: async () => children.promise,
          resumeChildren: async () => { resumes += 1 },
        },
      }))
      test.driver.run()
      const preparation = test.driver.beginRelocation()
      parent.resolve(outcome(status))
      await Bun.sleep(1)
      expect(test.outcomes.map((one) => one.status)).toEqual([status])
      children.resolve()
      await preparation
      expect(test.outcomes.map((one) => one.status)).toEqual([status, ETurnStatus.RelocationPaused])
      expect(test.driver.relocationResumable()).toBe(false)
      test.driver.resume()
      await Bun.sleep(1)
      expect(turns).toBe(1)
      expect(resumes).toBe(1)
    })
  }

  for (const intake of [false, true]) {
    it(`waits for an in-flight commit with intake ${intake} and continues its input only after rollback`, async () => {
      const written = gate<void>()
      let turns = 0
      let paused = false
      let parentResumes = 0
      const app = fakeServeApp({
        threadId, root: '/workspace', intake,
        runTurn: async () => { turns += 1; return outcome(ETurnStatus.Completed) },
        family: { pauseChildren: async () => { paused = true } },
      })
      app.runner.resume = async () => { parentResumes += 1; return outcome(ETurnStatus.Completed) }
      const append = app.log.append
      app.log.append = async (args) => { await written.promise; return append(args) }
      const test = fixture(app)
      const sending = test.driver.say({ text: 'accepted before freeze' })
      const preparation = test.driver.beginRelocation()
      await Bun.sleep(1)
      expect(paused).toBe(false)
      expect(test.outcomes).toEqual([])
      written.resolve()
      await sending
      await preparation
      expect(paused).toBe(true)
      expect(turns).toBe(0)
      expect(app.appended).toContainEqual({ type: 'user-said', text: 'accepted before freeze' })
      expect(test.driver.relocationResumable()).toBe(true)
      test.driver.resume()
      await Bun.sleep(1)
      expect(turns).toBe(1)
      expect(parentResumes).toBe(0)
      expect(test.driver.relocationResumable()).toBe(false)
      app.intake?.dispose()
    })
  }

  it('retains committed continuation intent through a failed family preparation', async () => {
    const writing = gate<void>()
    let turns = 0
    const test = fixture(fakeServeApp({
      threadId, root: '/workspace', runTurn: async () => { turns += 1; return outcome(ETurnStatus.Completed) },
      family: { pauseChildren: async () => { throw new Error('family persistence failed') } },
    }))
    test.driver.run()
    await test.driver.settled()
    const append = test.app.log.append
    test.app.log.append = async (args) => { await writing.promise; return append(args) }
    const sending = test.driver.say({ text: 'continue after the old completed turn' })
    const preparation = test.driver.beginRelocation()
    writing.resolve()
    await sending
    await expect(preparation).rejects.toThrow('family persistence failed')
    expect(test.driver.relocationResumable()).toBe(true)
    test.driver.resume()
    await Bun.sleep(1)
    expect(turns).toBe(2)
    expect(test.driver.relocationResumable()).toBe(false)
  })

  it('remembers a rejected active commit even if the family freeze is still awaiting its hold', async () => {
    const frozen = gate<void>()
    const writing = gate<void>()
    const test = fixture(fakeServeApp({
      threadId, root: '/workspace',
      family: { freeze: async () => frozen.promise, pauseChildren: async () => undefined },
    }))
    test.app.log.append = async () => { await writing.promise; return [] }
    const sending = test.driver.say({ text: 'pending commit' })
    const preparation = test.driver.beginRelocation()
    writing.reject(new Error('message commit failed'))
    await expect(sending).rejects.toThrow('message commit failed')
    frozen.resolve()
    await expect(preparation).rejects.toThrow('message commit failed')
    expect(test.outcomes).toEqual([])
  })

  it('rejects a parent crash even though settled historically swallowed the runner failure', async () => {
    const parent = gate<TurnOutcome>()
    let pauses = 0
    const test = fixture(fakeServeApp({
      threadId, root: '/workspace', runTurn: () => parent.promise,
      family: { pauseChildren: async () => { pauses += 1 } },
    }))
    test.driver.run()
    const preparation = test.driver.beginRelocation()
    parent.reject(new Error('model transport failed'))
    await expect(preparation).rejects.toThrow('model transport failed')
    expect(test.outcomes).toEqual([])
    expect(pauses).toBe(0)
    await expect(test.driver.say({ text: 'unsafe input' })).rejects.toThrow('paused')
  })

  it('rejects an explicit failed parent outcome', async () => {
    const parent = gate<TurnOutcome>()
    const test = fixture(fakeServeApp({ threadId, root: '/workspace', runTurn: () => parent.promise }))
    test.driver.run()
    const preparation = test.driver.beginRelocation()
    parent.resolve({ status: ETurnStatus.Failed, runId: toRunId('failed-run'), message: 'tool append failed', cause: null })
    await expect(preparation).rejects.toThrow('tool append failed')
    expect(test.outcomes.map((one) => one.status)).toEqual([ETurnStatus.Failed])
  })

  it('keeps failures frozen and retries family confirmation without an unhandled rejection', async () => {
    let attempts = 0
    const test = fixture(fakeServeApp({
      threadId, root: '/workspace', family: {
        pauseChildren: async () => { attempts += 1; if (attempts === 1) throw new Error('child append failed') },
      },
    }))
    test.driver.beginRelocation()
    await Bun.sleep(1)
    expect(test.failures).toEqual(['child append failed'])
    expect(test.outcomes).toEqual([])
    await expect(test.driver.say({ text: 'unsafe input' })).rejects.toThrow('paused')
    await test.driver.beginRelocation()
    expect(attempts).toBe(2)
    expect(test.outcomes.map((one) => one.status)).toEqual([ETurnStatus.RelocationPaused])
  })

  it('waits for a blocked family resume before confirming a fresh freeze and pause', async () => {
    const resumed = gate<void>()
    const order: string[] = []
    const test = fixture(fakeServeApp({
      threadId, root: '/workspace', family: {
        freeze: async () => { order.push('freeze') },
        pauseChildren: async () => { order.push('pause') },
        resumeChildren: async () => { order.push('resume'); await resumed.promise; order.push('resumed') },
      },
    }))
    const first = test.driver.beginRelocation()
    await first
    test.driver.resume()
    const second = test.driver.beginRelocation()
    expect(second).not.toBe(first)
    let confirmed = false
    void second.then(() => { confirmed = true })
    await Bun.sleep(1)
    expect(confirmed).toBe(false)
    expect(order).toEqual(['freeze', 'pause', 'resume'])
    resumed.resolve()
    await second
    expect(order).toEqual(['freeze', 'pause', 'resume', 'resumed', 'freeze', 'pause'])
    expect(test.outcomes.filter((one) => one.status === ETurnStatus.RelocationPaused)).toHaveLength(2)
    await expect(test.driver.say({ text: 'cannot write after fresh proof' })).rejects.toThrow('paused')
  })

  it('resets confirmed preparation after resume', async () => {
    let pauses = 0
    const test = fixture(fakeServeApp({
      threadId, root: '/workspace', family: { pauseChildren: async () => { pauses += 1 } },
    }))
    const first = test.driver.beginRelocation()
    await first
    test.driver.resume()
    await Bun.sleep(1)
    const second = test.driver.beginRelocation()
    expect(second).not.toBe(first)
    await second
    expect(pauses).toBe(2)
  })
})
