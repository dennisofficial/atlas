import { toCallId, type EventDraft } from '@dltech/atlas-core'
import { EClientFrame, EStepEnd, ETurnStatus, toStepId } from '@dltech/atlas-harness'
import { afterEach, describe, expect, it } from 'bun:test'

import { currentNotices, dismissNotice } from '../../ui/notice-store'
import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { fakeApp, scriptedModelPort } from './fake-app'
import { capture, mounted, seeded, wire } from './cloud-turn-state-fixture'

await grammarsReady()

const STEP = toStepId('cloud-turn-state#1')

const NEXT_STEP = toStepId('cloud-turn-state#2')

const WORKING = 'esc to interrupt'

const RESUME_HINT = 'resume'

const INTERRUPTED_NOTICE = 'The turn was interrupted.'

const ASKED: EventDraft = { type: 'user-said', text: 'list the packages' }

const PENDING_TOOL: readonly EventDraft[] = [
  ASKED,
  { type: 'tool-called', callId: toCallId('call-ls'), name: 'read', ordinal: 0 },
]

const UNANSWERED: readonly EventDraft[] = [ASKED]

const ANSWERED: readonly EventDraft[] = [
  ASKED,
  { type: 'assistant-said', parts: [{ type: 'text', text: 'Five packages live here.' }] },
]

async function arrange(drafts: readonly EventDraft[]) {
  const app = fakeApp({
    model: scriptedModelPort({ script: { thinking: '', reply: 'unused' }, perChunkMs: 1 }),
  })
  const channel = wire(app)
  const opened = await seeded(app, drafts)

  return { app, channel, opened }
}

const trimmed = (frame: string): string =>
  frame
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trimEnd()

afterEach(() => {
  dismissNotice()
})

describe('a turn the sandbox starts by itself, with this TUI only watching', () => {
  it('reads as working from turn-working through the step gaps, with no resume hint', async () => {
    const { app, channel, opened } = await arrange(PENDING_TOOL)
    const screen = await mounted({ app, opened })

    try {
      channel.ready(false)
      await screen.quiet()
      expect(screen.conversation().working).toBe(false)
      expect(screen.conversation().turnInFlight()).toBe(false)

      channel.signal({ type: 'turn-working', working: true })
      const started = await screen.until(
        (frame) => frame.includes(WORKING),
        'the working line once the sandbox reports turn-working',
      )
      expect(started).not.toContain(RESUME_HINT)
      expect(screen.conversation().working).toBe(true)
      expect(screen.conversation().turnInFlight()).toBe(true)

      channel.signal({ type: 'step-started', stepId: STEP })
      channel.signal({ type: 'step-ended', stepId: STEP, end: EStepEnd.Completed, supersededBy: null })
      const gap = await screen.quiet(300)
      capture({ name: 'working-between-steps', frame: trimmed(gap) })

      expect(gap).toContain(WORKING)
      expect(gap).not.toContain(RESUME_HINT)
      expect(screen.conversation().working).toBe(true)
      expect(screen.conversation().turnInFlight()).toBe(true)
      expect(screen.conversation().handleResume).toBeNull()

      channel.signal({ type: 'step-started', stepId: NEXT_STEP })
      const waiting = await screen.quiet(300)
      expect(waiting).not.toContain(RESUME_HINT)
      expect(screen.conversation().working).toBe(true)
    } finally {
      await screen.done()
    }
  }, 30_000)

  it('stops reading as working on completion and offers resume only for an unfinished log', async () => {
    const { app, channel, opened } = await arrange(UNANSWERED)
    const screen = await mounted({ app, opened })

    try {
      channel.ready(false)
      channel.signal({ type: 'turn-working', working: true })
      await screen.until((frame) => frame.includes(WORKING), 'the working line')

      channel.end(ETurnStatus.Completed)
      const stopped = await screen.until(
        (frame) => frame.includes(RESUME_HINT),
        'the resume hint once the turn ended on an unfinished log',
      )
      capture({ name: 'stopped-resume', frame: trimmed(stopped) })

      expect(stopped).not.toContain(WORKING)
      expect(screen.conversation().working).toBe(false)
      expect(screen.conversation().turnInFlight()).toBe(false)
      expect(screen.conversation().handleResume).not.toBeNull()
    } finally {
      await screen.done()
    }
  }, 30_000)

  it('shows no resume hint after completion when the log is already answered', async () => {
    const { app, channel, opened } = await arrange(ANSWERED)
    const screen = await mounted({ app, opened })

    try {
      channel.ready(false)
      channel.signal({ type: 'turn-working', working: true })
      await screen.until((frame) => frame.includes(WORKING), 'the working line')

      channel.end(ETurnStatus.Completed)
      await screen.until((frame) => !frame.includes(WORKING), 'the working line to clear')
      const settled = await screen.quiet(300)

      expect(settled).not.toContain(RESUME_HINT)
      expect(screen.conversation().working).toBe(false)
      expect(screen.conversation().turnInFlight()).toBe(false)
      expect(screen.conversation().handleResume).toBeNull()
    } finally {
      await screen.done()
    }
  }, 30_000)

  it('settles on an interrupted ending and offers resume for the unfinished log', async () => {
    const { app, channel, opened } = await arrange(UNANSWERED)
    const screen = await mounted({ app, opened })

    try {
      channel.ready(false)
      channel.signal({ type: 'turn-working', working: true })
      await screen.until((frame) => frame.includes(WORKING), 'the working line')

      channel.interrupted()
      const stopped = await screen.until(
        (frame) => frame.includes(RESUME_HINT) && !frame.includes(WORKING),
        'the resume hint after the interrupted ending',
      )

      expect(stopped).not.toContain('Interrupting')
      expect(screen.conversation().working).toBe(false)
      expect(screen.conversation().turnInFlight()).toBe(false)
    } finally {
      await screen.done()
    }
  }, 30_000)
})

describe('mounting while the sandbox is already mid-turn', () => {
  it('reads as working at once and sends the interrupt frame without a local drive', async () => {
    const { app, channel, opened } = await arrange(PENDING_TOOL)
    channel.ready(true)
    channel.signal({ type: 'turn-working', working: true })
    const screen = await mounted({ app, opened })

    try {
      const late = await screen.until((frame) => frame.includes(WORKING), 'the working line on a late mount')
      capture({ name: 'late-mount-working', frame: trimmed(late) })
      expect(late).not.toContain(RESUME_HINT)
      expect(screen.conversation().working).toBe(true)
      expect(screen.conversation().turnInFlight()).toBe(true)

      screen.conversation().handleInterrupt()
      const interrupting = await screen.until(
        (frame) => frame.includes('Interrupting'),
        'the interrupting line',
      )
      capture({ name: 'late-mount-interrupting', frame: trimmed(interrupting) })
      expect(channel.frames.filter((frame) => frame.kind === EClientFrame.Interrupt)).toHaveLength(1)

      channel.acknowledgeInterrupt()
      await screen.until(
        () => currentNotices().some((notice) => notice.text === INTERRUPTED_NOTICE),
        'the interrupt acknowledgement notice',
      )

      channel.interrupted()
      const settled = await screen.until(
        (frame) => !frame.includes(WORKING) && !frame.includes('Interrupting'),
        'no working or interrupting status left behind',
      )
      capture({ name: 'late-mount-settled', frame: trimmed(settled) })

      expect(screen.conversation().working).toBe(false)
      expect(screen.conversation().turnInFlight()).toBe(false)
    } finally {
      await screen.done()
    }
  }, 30_000)

  it('clears the working status when the late-mounted turn ends without any local drive', async () => {
    const { app, channel, opened } = await arrange(ANSWERED)
    channel.ready(true)
    channel.signal({ type: 'turn-working', working: true })
    const screen = await mounted({ app, opened })

    try {
      await screen.until((frame) => frame.includes(WORKING), 'the working line on a late mount')

      channel.end(ETurnStatus.Completed)
      const settled = await screen.until((frame) => !frame.includes(WORKING), 'the working line to clear')

      expect(settled).not.toContain(RESUME_HINT)
      expect(screen.conversation().working).toBe(false)
      expect(screen.conversation().turnInFlight()).toBe(false)
    } finally {
      await screen.done()
    }
  }, 30_000)
})
