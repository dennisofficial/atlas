import { describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'
import { testRender } from '@opentui/react/test-utils'
import React, { useEffect, useRef } from 'react'

import { teardown } from '../../ui/markdown/__tests__/harness'
import type { AtlasApp } from '../compose'
import { EOpenMode } from '../config'
import type { OpenedConversation } from '../open-conversation'
import { scriptedModelPort } from './fake-app'
import { fakeApp } from './fake-app'
import { useResumeOnOpen } from '../use-conversation-resume'
import type { RewindConfirmControl } from '../use-rewind-confirm'
import type { TurnDriver } from '../use-turn-driver'

const NOOP_REWIND_CONFIRM: RewindConfirmControl = {
  state: null,
  handleOpen: () => undefined,
  handleDismiss: () => undefined,
  handleConfirm: () => undefined,
  handleKey: () => undefined,
}

type Probe = { resumed: number; resumedFresh: number }

function ResumeOnOpenProbe(props: {
  app: AtlasApp
  opened: OpenedConversation
  turnInFlight: boolean
  probe: Probe
}): React.ReactNode {
  const turnInFlightRef = useRef(props.turnInFlight)
  useEffect(() => {
    turnInFlightRef.current = props.turnInFlight
  }, [props.turnInFlight])
  const driver: TurnDriver = {
    working: false,
    workingRef: { current: false },
    rewindConfirm: NOOP_REWIND_CONFIRM,
    drive: async () => undefined,
    handleInterrupt: () => undefined,
    handleInterruptForMove: () => undefined,
    handlePauseForMove: () => undefined,
    lastOutcome: { current: null },
    turnInFlight: () => turnInFlightRef.current,
    handleRetry: () => undefined,
    handleResume: () => {
      props.probe.resumed += 1
    },
    handleResumeFresh: () => {
      props.probe.resumedFresh += 1
    },
    handleRewindTo: () => undefined,
    isResumable: true,
    settle: () => undefined,
    whenSettled: async () => undefined,
  }
  useResumeOnOpen({ app: props.app, opened: props.opened, turnDriver: driver, moving: false })
  return <text>probe</text>
}

async function mountResumeOnOpen(args: { turnInFlight: boolean; resumeOnArrival?: boolean }) {
  const app = fakeApp({
    model: scriptedModelPort({ script: { thinking: '', reply: 'done' } }),
    open: { mode: EOpenMode.Continue },
  })
  const opened: OpenedConversation = {
    threadId: toThreadId('resume-on-open-probe'),
    started: true,
    events: [],
    turns: [],
    name: null,
    ...(args.resumeOnArrival === true ? { resumeOnArrival: true } : {}),
  }
  const probe: Probe = { resumed: 0, resumedFresh: 0 }
  const setup = await testRender(
    <ResumeOnOpenProbe app={app} opened={opened} turnInFlight={args.turnInFlight} probe={probe} />,
    { width: 80, height: 8 },
  )
  await setup.flush()
  return { probe, done: () => teardown(setup) }
}

describe('auto-resume on open', () => {
  it('resumes an idle thread opened in continue mode', async () => {
    const mounted = await mountResumeOnOpen({ turnInFlight: false })
    try {
      expect(mounted.probe.resumed).toBe(1)
    } finally {
      await mounted.done()
    }
  })

  it('does not fire a resume while a turn is already in flight', async () => {
    const mounted = await mountResumeOnOpen({ turnInFlight: true })
    try {
      expect(mounted.probe.resumed).toBe(0)
    } finally {
      await mounted.done()
    }
  })

  it('does not fire the arrival resume while a turn is already in flight', async () => {
    const mounted = await mountResumeOnOpen({ turnInFlight: true, resumeOnArrival: true })
    try {
      expect(mounted.probe.resumedFresh).toBe(0)
    } finally {
      await mounted.done()
    }
  })
})
