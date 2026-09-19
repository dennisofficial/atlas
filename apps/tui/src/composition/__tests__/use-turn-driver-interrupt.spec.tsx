import { toThreadId, type EventDraft } from '@dltech/atlas-core'
import { testRender } from '@opentui/react/test-utils'
import { afterEach, describe, expect, it } from 'bun:test'
import React, { useRef } from 'react'

import { SHIPPED_THINKING } from '../../store'
import { currentNotices, dismissNotice } from '../../ui/notice-store'
import { settle, teardown } from '../../ui/markdown/__tests__/harness'
import type { DirectoryMove } from '../directory-move'
import { EThreadRows, useThreadView } from '../use-thread-view'
import { useTurnDriver, type TurnDriver } from '../use-turn-driver'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

const THREAD = toThreadId('turn-driver-interrupt')

const RENDER_MS = 60

const SAY: EventDraft = { type: 'user-said', text: 'go' }

const REFUSAL = "the sandbox socket is down — esc will interrupt once it's back"

type Probe = { driver: TurnDriver | null; interrupting: boolean }

function DriverProbe(props: {
  app: FakeApp
  probe: Probe
  interruptRefusal?: () => string | null
}): React.ReactNode {
  const started = useRef(true)
  const pendingMove = useRef<DirectoryMove | null>(null)
  const used = useRef(0)

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
    started,
    pendingMove,
    view,
    readClock: () => 0,
    used,
    compactIfFull: async () => undefined,
    cancelCompaction: () => false,
    onSettled: async () => undefined,
    onUndone: () => undefined,
    setFailure: () => undefined,
    forgetUsage: () => undefined,
    ...(props.interruptRefusal === undefined ? {} : { interruptRefusal: props.interruptRefusal }),
  })

  props.probe.driver = driver
  props.probe.interrupting = view.turn.interrupting

  return <text>{driver.working ? 'working' : 'idle'}</text>
}

const driverOf = (probe: Probe): TurnDriver => {
  if (probe.driver === null) throw new Error('the probe never mounted')
  return probe.driver
}

async function mounted(args: { interruptRefusal?: () => string | null } = {}): Promise<{
  probe: Probe
  flush: () => Promise<void>
  done: () => Promise<void>
}> {
  const app = fakeApp({
    model: scriptedModelPort({ script: { thinking: '', reply: 'ok' }, perChunkMs: 200 }),
  })
  const probe: Probe = { driver: null, interrupting: false }
  const setup = await testRender(
    <DriverProbe
      app={app}
      probe={probe}
      {...(args.interruptRefusal === undefined ? {} : { interruptRefusal: args.interruptRefusal })}
    />,
    { width: 60, height: 6 },
  )
  await setup.flush()

  return {
    probe,
    flush: async () => {
      await settle(RENDER_MS)
      await setup.flush()
    },
    done: () => teardown(setup),
  }
}

afterEach(() => {
  dismissNotice()
})

describe('the interrupt gate Esc goes through', () => {
  it('refuses and warns instead of aborting when a reason is given', async () => {
    const { probe, flush, done } = await mounted({ interruptRefusal: () => REFUSAL })

    try {
      void driverOf(probe).drive([SAY])
      await flush()
      expect(driverOf(probe).working).toBe(true)

      driverOf(probe).handleInterrupt()
      await flush()

      expect(driverOf(probe).working).toBe(true)
      expect(probe.interrupting).toBe(false)
      expect(currentNotices().some((notice) => notice.text === REFUSAL)).toBe(true)

      await driverOf(probe).whenSettled()
    } finally {
      await done()
    }
  }, 20_000)

  it('aborts as before once there is no reason to refuse', async () => {
    const { probe, flush, done } = await mounted({ interruptRefusal: () => null })

    try {
      void driverOf(probe).drive([SAY])
      await flush()
      expect(driverOf(probe).working).toBe(true)

      driverOf(probe).handleInterrupt()
      await flush()

      expect(probe.interrupting).toBe(true)
      expect(currentNotices()).toEqual([])

      await driverOf(probe).whenSettled()
    } finally {
      await done()
    }
  }, 20_000)

  it('leaves esc free to abort when nobody wired a refusal at all', async () => {
    const { probe, flush, done } = await mounted()

    try {
      void driverOf(probe).drive([SAY])
      await flush()
      expect(driverOf(probe).working).toBe(true)

      driverOf(probe).handleInterrupt()
      await flush()

      expect(probe.interrupting).toBe(true)

      await driverOf(probe).whenSettled()
    } finally {
      await done()
    }
  }, 20_000)

  it('lets a directory move interrupt through the same reason a press would be refused for', async () => {
    const { probe, flush, done } = await mounted({ interruptRefusal: () => REFUSAL })

    try {
      void driverOf(probe).drive([SAY])
      await flush()
      expect(driverOf(probe).working).toBe(true)

      driverOf(probe).handleInterruptForMove()
      await flush()

      expect(probe.interrupting).toBe(true)
      expect(currentNotices()).toEqual([])

      await driverOf(probe).whenSettled()
    } finally {
      await done()
    }
  }, 20_000)
})
