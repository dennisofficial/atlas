import { toThreadId } from '@dltech/atlas-core'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React, { useRef } from 'react'

import { createRemoteDeltaChannel, RemoteTurnDetached, RemoteTurnRunner, type TurnOutcome } from '@dltech/atlas-harness'

import { SHIPPED_THINKING } from '../../store'
import { settle, teardown } from '../../ui/markdown/__tests__/harness'
import type { DirectoryMove } from '../directory-move'
import { EThreadRows, useThreadView } from '../use-thread-view'
import { useTurnDriver, type TurnDriver } from '../use-turn-driver'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

const THREAD = toThreadId('turn-driver-detach')

class DetachingRunner extends RemoteTurnRunner {
  private readonly outcome: Promise<TurnOutcome>
  private readonly detachTurn: (reason: Error) => void

  constructor() {
    const channel = createRemoteDeltaChannel({
      threadId: THREAD,
      url: 'https://sandbox.example',
      token: 'test-token',
      socketFactory: () => ({ send: () => undefined, close: () => undefined }),
      scheduleKeepalive: () => () => undefined,
    })
    super({ channel, wake: async () => undefined })
    let detachTurn = (_reason: Error): void => undefined
    this.outcome = new Promise<TurnOutcome>((_resolve, reject) => { detachTurn = reject })
    this.detachTurn = detachTurn
  }

  override say(): Promise<TurnOutcome> {
    return this.outcome
  }

  detach(): void {
    this.detachTurn(new RemoteTurnDetached('client detached'))
  }
}

type Probe = { driver: TurnDriver | null; failure: string | null }

function DriverProbe(props: { app: FakeApp; probe: Probe }): React.ReactNode {
  const started = useRef(true)
  const pendingMove = useRef<DirectoryMove | null>(null)
  const view = useThreadView({
    app: props.app, threadId: THREAD, rows: EThreadRows.Own,
    thinking: SHIPPED_THINKING, readClock: () => 0,
  })
  const driver = useTurnDriver({
    app: props.app, threadId: THREAD, remoteChannel: null, started, pendingMove, view,
    readClock: () => 0, onSettled: async () => undefined, onUndone: () => undefined,
    setFailure: (failure) => { props.probe.failure = failure },
    forgetUsage: () => undefined, cancelCompaction: () => false,
  })
  props.probe.driver = driver
  return <text>{driver.working ? 'working' : 'idle'}</text>
}

const driverOf = (probe: Probe): TurnDriver => {
  if (probe.driver === null) throw new Error('the probe never mounted')
  return probe.driver
}

describe('a turn the session detached from', () => {
  it('settles a detached waiter without marking a failure or reporting a crash', async () => {
    const local = fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: 'ok' }, perChunkMs: 1 }) })
    let crashed = false
    const runner = new DetachingRunner()
    const app = {
      ...local,
      runner,
      turnPolicy: { ...local.turnPolicy, onCrashed: async () => { crashed = true } },
    }
    const probe: Probe = { driver: null, failure: null }
    const setup = await testRender(<DriverProbe app={app} probe={probe} />, { width: 60, height: 6 })
    await setup.flush()
    try {
      await driverOf(probe).drive([{ type: 'user-said', text: 'go' }])
      await settle(60)
      expect(driverOf(probe).working).toBe(true)
      runner.detach()
      await driverOf(probe).whenSettled()
      await settle(60)
      await setup.flush()
      expect(driverOf(probe).working).toBe(false)
      expect(crashed).toBe(false)
      expect(probe.failure).toBeNull()
    } finally {
      await teardown(setup)
    }
  }, 20_000)
})
