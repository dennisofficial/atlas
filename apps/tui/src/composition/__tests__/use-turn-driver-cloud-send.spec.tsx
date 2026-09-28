import { toThreadId, type EventDraft, type ThreadId } from '@dltech/atlas-core'
import { testRender } from '@opentui/react/test-utils'
import { afterEach, describe, expect, it } from 'bun:test'
import React, { useRef } from 'react'

import { RemoteTurnRunner, type TurnOutcome } from '@dltech/atlas-harness'

import { SHIPPED_THINKING } from '../../store'
import { dismissNotice } from '../../ui/notice-store'
import { settle, teardown } from '../../ui/markdown/__tests__/harness'
import type { DirectoryMove } from '../directory-move'
import { EThreadRows, useThreadView } from '../use-thread-view'
import { useTurnDriver, type TurnDriver } from '../use-turn-driver'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

const THREAD = toThreadId('turn-driver-cloud-send')

const RENDER_MS = 60

const SAY: EventDraft = { type: 'user-said', text: 'hello from the laptop' }

type SentCall = { text: string; context?: readonly EventDraft[] | undefined }

/**
 * A RemoteTurnRunner in every way the driver inspects — `instanceof` holds — with the channel
 * swapped for a recorder, so the spec sees what the laptop would have put on the wire.
 */
class FakeRemoteRunner extends RemoteTurnRunner {
  readonly sent: SentCall[] = []
  private answer!: (outcome: TurnOutcome) => void
  private readonly outcome: Promise<TurnOutcome>

  constructor() {
    let answer!: (outcome: TurnOutcome) => void
    const outcome = new Promise<TurnOutcome>((resolve) => {
      answer = resolve
    })
    const channel = {
      threadId: THREAD,
      connection: () => ({ state: 'open', detail: null }),
      send: () => undefined,
      run: () => undefined,
      interrupt: () => undefined,
      pause: () => undefined,
      onTurnEnded: () => () => undefined,
      onConnection: () => () => undefined,
      onReady: () => () => undefined,
      onServerError: () => () => undefined,
    }
    super({
      channel: channel as unknown as ConstructorParameters<typeof RemoteTurnRunner>[0]['channel'],
      wake: async () => undefined,
    })
    this.outcome = outcome
    this.answer = answer
  }

  override say(args: {
    threadId: ThreadId
    text: string
    context?: readonly EventDraft[] | undefined
  }): Promise<TurnOutcome> {
    this.sent.push({
      text: args.text,
      ...(args.context === undefined ? {} : { context: args.context }),
    })
    queueMicrotask(() => this.answer({ status: 'completed' } as TurnOutcome))
    return this.outcome
  }
}

type Probe = { driver: TurnDriver | null }

function DriverProbe(props: { app: FakeApp; probe: Probe }): React.ReactNode {
  const started = useRef(true)
  const pendingMove = useRef<DirectoryMove | null>(null)

  const view = useThreadView({
    app: props.app,
    threadId: THREAD,
    rows: EThreadRows.Own,
    thinking: SHIPPED_THINKING,
    readClock: () => 0,
  })

  const driver = useTurnDriver({
    app: props.app,
    threadId: THREAD,
    remoteChannel: null,
    started,
    pendingMove,
    view,
    readClock: () => 0,
    onSettled: async () => undefined,
    onUndone: () => undefined,
    setFailure: () => undefined,
    forgetUsage: () => undefined,
    cancelCompaction: () => false,
  })

  props.probe.driver = driver
  return <text>{driver.working ? 'working' : 'idle'}</text>
}

const driverOf = (probe: Probe): TurnDriver => {
  if (probe.driver === null) throw new Error('the probe never mounted')
  return probe.driver
}

afterEach(() => {
  dismissNotice()
})

describe('a send on a cloud thread', () => {
  it('goes to the remote runner as a say, never to the channel-owned log', async () => {
    const app = fakeApp({
      model: scriptedModelPort({ script: { thinking: '', reply: 'ok' }, perChunkMs: 1 }),
    })
    const remote = new FakeRemoteRunner()
    ;(app as { runner: unknown }).runner = remote

    const appends: EventDraft[][] = []
    // A cloud thread's log is channel-owned: every append rejects, as RemoteEventLog's does.
    app.log.append = ((args: { drafts: readonly EventDraft[] }) => {
      appends.push([...args.drafts])
      return Promise.reject(
        new Error('the sandbox owns the transcript while lifted — reads only over the channel'),
      )
    }) as typeof app.log.append

    const probe: Probe = { driver: null }
    const setup = await testRender(<DriverProbe app={app} probe={probe} />, { width: 60, height: 6 })
    await setup.flush()

    try {
      let commitError: unknown = null
      void driverOf(probe).drive([SAY], {
        onCommitFailed: (error) => {
          commitError = error
        },
      })
      await settle(RENDER_MS)
      await setup.flush()
      await driverOf(probe).whenSettled()

      expect(remote.sent).toEqual([{ text: 'hello from the laptop' }])
      expect(appends).toEqual([])
      expect(commitError).toBeNull()
    } finally {
      await teardown(setup)
    }
  }, 20_000)
})
