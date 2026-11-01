import { describe, expect, it } from 'bun:test'
import { toRunId, toThreadId, type ThreadId } from '@dltech/atlas-core'
import { ETurnStatus, type ChannelSignal } from '@dltech/atlas-harness'

import { EWorkspaceState } from '../materialize-workspace'
import { createServeDriver } from '../serve-driver'
import { fakeServeApp } from './fakes'

const threadId: ThreadId = toThreadId('driver-working')
const noop = (): void => undefined

const gate = () => {
  let open: () => void = noop
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { opened, open }
}

const fixture = (beforeTurn: () => Promise<void>) => {
  const app = fakeServeApp({
    threadId,
    root: '/workspace',
    runTurn: async () => {
      const publisher = app.channel.publisherFor({ threadId })
      publisher.turnWorking({ working: true })
      publisher.turnWorking({ working: false })
      return {
        status: ETurnStatus.Completed,
        runId: toRunId('driver-working-run'),
      }
    },
  })
  const seen: ChannelSignal[] = []
  app.channel.subscribe({
    threadId,
    listener: (signal) => void seen.push(signal),
  })
  const driver = createServeDriver({
    app,
    threadId,
    workspace: { state: EWorkspaceState.Skipped },
    log: noop,
    idleStop: () => ({ note: noop }),
    emitLifecycle: noop,
    beforeTurn,
  })
  const workings = () =>
    seen.flatMap((signal) => (signal.type === 'turn-working' ? [signal.working] : []))
  return { driver, workings }
}

describe('the working signal a serve turn announces', () => {
  it('is already working while the pre-turn refresh is still out', async () => {
    const refresh = gate()
    const { driver, workings } = fixture(() => refresh.opened)

    driver.run()

    expect(workings()).toEqual([true])
    refresh.open()
    await driver.settled()
    expect(workings()).toEqual([true, false])
  })

  it('does not drop to idle between passes when a turn runs again', async () => {
    const refresh = gate()
    let refreshes = 0
    const { driver, workings } = fixture(async () => {
      refreshes += 1
      if (refreshes === 1) await refresh.opened
    })

    driver.run()
    driver.run()
    refresh.open()
    await driver.settled()

    expect(refreshes).toBe(2)
    expect(workings()).toEqual([true, false])
  })
})
