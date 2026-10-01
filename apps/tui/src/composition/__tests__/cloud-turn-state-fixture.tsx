import {
  EExecutionLocation,
  toRunId,
  toThreadId,
  type EventDraft,
} from '@dltech/atlas-core'
import {
  createRemoteDeltaChannel,
  decodeClientFrame,
  encodeFrame,
  EServeFrame,
  ETurnStatus,
  RemoteTurnRunner,
  type ChannelSignal,
  type ChannelSocketHandlers,
  type ClientFrame,
} from '@dltech/atlas-harness'
import { writeFileSync } from 'node:fs'

import { testRender } from '@opentui/react/test-utils'
import React, { useState } from 'react'

import { SHIPPED_THINKING } from '../../store'
import { Transcript } from '../../ui/components/transcript'
import { frameWhen } from '../../ui/__tests__/waiting'
import { settle, teardown } from '../../ui/markdown/__tests__/harness'
import type { OpenedConversation } from '../open-conversation'
import { useConversation, type Conversation } from '../use-conversation'
import type { FakeApp } from './fake-app'

export const THREAD = toThreadId('cloud-turn-state')

const WIDTH = 80

const HEIGHT = 24

const WAIT_MS = 8_000

const CAPTURE_ENV = 'ATLAS_CAPTURE_TURN_FRAMES'

const captured: Record<string, string> = {}

export function capture(args: { name: string; frame: string }): void {
  captured[args.name] = args.frame
  const target = process.env[CAPTURE_ENV]
  if (target === undefined || target === '') return
  writeFileSync(target, JSON.stringify(captured, null, 2))
}

export type Wired = ReturnType<typeof wire>

export function wire(app: FakeApp) {
  const frames: ClientFrame[] = []
  const socket: { handlers: ChannelSocketHandlers | null } = { handlers: null }
  let seq = 0

  const channel = createRemoteDeltaChannel({
    threadId: THREAD,
    url: 'https://sandbox.test/',
    token: 'tok_session',
    scheduleRetry: () => undefined,
    scheduleTimeout: () => undefined,
    scheduleKeepalive: () => () => undefined,
    socketFactory: (made) => {
      socket.handlers = made.handlers
      return {
        send: (data) => {
          const frame = decodeClientFrame(data)
          if (frame !== null) frames.push(frame)
        },
        close: () => undefined,
      }
    },
  })
  const runner = new RemoteTurnRunner({ channel, wake: async () => undefined })
  Object.assign(app, { channel, runner })

  const receive = (data: string): void => {
    if (socket.handlers === null) throw new Error('the channel never dialled')
    socket.handlers.handleMessage(data)
  }

  const signal = (next: ChannelSignal): void => {
    seq += 1
    receive(encodeFrame({ kind: EServeFrame.Signal, seq, signal: next }))
  }

  socket.handlers?.handleOpen()

  return {
    app,
    frames,
    ready: (turnInFlight: boolean): void =>
      receive(encodeFrame({ kind: EServeFrame.Ready, seq: 1, turnInFlight })),
    signal,
    fail: (message: string): void => receive(encodeFrame({ kind: EServeFrame.Error, message })),
    acknowledgeInterrupt: (): void =>
      receive(encodeFrame({ kind: EServeFrame.InterruptAcked, seq: 1 })),
    end: (status: ETurnStatus.Completed | ETurnStatus.Idle): void => {
      signal({ type: 'turn-working', working: false })
      receive(
        encodeFrame({
          kind: EServeFrame.TurnEnded,
          outcome: { status, runId: toRunId('run-remote') },
        }),
      )
    },
    interrupted: (): void => {
      signal({ type: 'turn-working', working: false })
      receive(
        encodeFrame({
          kind: EServeFrame.TurnEnded,
          outcome: {
            status: ETurnStatus.Interrupted,
            runId: toRunId('run-remote'),
            committed: false,
          },
        }),
      )
    },
  }
}

export async function seeded(
  app: FakeApp,
  drafts: readonly EventDraft[],
): Promise<OpenedConversation> {
  const events = await app.log.append({ threadId: THREAD, runId: toRunId('run-before'), drafts })

  return {
    threadId: THREAD,
    events,
    turns: [],
    name: null,
    started: true,
    executionLocation: EExecutionLocation.Cloud,
  }
}

type Probe = { conversation: Conversation | null; setPaceReveal: ((next: boolean) => void) | null }

function Screen(props: { app: FakeApp; opened: OpenedConversation; probe: Probe }): React.ReactNode {
  const [paceReveal, setPaceReveal] = useState(false)
  props.probe.setPaceReveal = setPaceReveal
  const conversation = useConversation({
    app: props.app,
    opened: props.opened,
    paceReveal,
    thinking: SHIPPED_THINKING,
    tldrStatus: false,
    onUndone: () => undefined,
    canWake: false,
  })
  props.probe.conversation = conversation

  return (
    <box flexDirection="column" width={WIDTH} height={HEIGHT}>
      <Transcript
        model={conversation.model}
        width={WIDTH}
        now={conversation.now}
        cwd={conversation.projectDirectory}
        turn={conversation.turn}
        {...(conversation.handleResume === null ? {} : { onResume: conversation.handleResume })}
      />
    </box>
  )
}

export async function mounted(args: { app: FakeApp; opened: OpenedConversation }) {
  const probe: Probe = { conversation: null, setPaceReveal: null }
  const setup = await testRender(
    <Screen app={args.app} opened={args.opened} probe={probe} />,
    { width: WIDTH, height: HEIGHT },
  )
  await setup.flush()

  const conversation = (): Conversation => {
    if (probe.conversation === null) throw new Error('the conversation never mounted')
    return probe.conversation
  }

  const togglePaceReveal = async (next: boolean): Promise<void> => {
    if (probe.setPaceReveal === null) throw new Error('the screen never mounted')
    probe.setPaceReveal(next)
    await setup.flush().catch(() => undefined)
  }

  return {
    conversation,
    togglePaceReveal,
    until: (holds: (frame: string) => boolean, describe: string): Promise<string> =>
      frameWhen({ setup, holds, within: WAIT_MS, describe }),
    quiet: async (ms = 150): Promise<string> => {
      await settle(ms)
      await setup.flush().catch(() => undefined)
      return setup.captureCharFrame()
    },
    done: () => teardown(setup),
  }
}
