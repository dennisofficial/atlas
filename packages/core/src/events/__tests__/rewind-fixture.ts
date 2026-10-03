import { EShellStatus } from '../../shells/status'
import type { EventDraft } from '../body'
import type { Event } from '../envelope'
import { toThreadId, toCallId, toEventId, toRunId } from '../ids'
import type { rewindPlan } from '../rewind-plan'
import { stampDrafts } from '../stamp'

export const eventsFrom = (drafts: readonly EventDraft[]): Event[] =>
  stampDrafts({
    drafts,
    envelopes: drafts.map((_, index) => ({
      id: toEventId(`evt-${index + 1}`),
      seq: index + 1,
      threadId: toThreadId('thread-1'),
      runId: toRunId('run-1'),
      depth: 0,
      at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    })),
  })

export const said = (text: string): EventDraft => ({ type: 'user-said', text })
export const replied = (text: string): EventDraft => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text }],
})
export const startedInBackground = (callId: string): EventDraft => ({
  type: 'tool-called',
  callId: toCallId(callId),
  name: 'bash',
  input: { command: 'npm test', runInBackground: true },
  ordinal: 0,
})
export const backgrounded = ({ callId, shellId }: { callId: string; shellId: string }): EventDraft => ({
  type: 'tool-result',
  callId: toCallId(callId),
  name: 'bash',
  output: { shellId, status: 'running' },
})
export const shellStarted = (shellId: string): EventDraft => ({
  type: 'background-shell-started',
  shellId,
  command: 'npm test',
  description: 'run the tests',
})
export const shellEnded = ({ shellId, output }: { shellId: string; output: string }): EventDraft => ({
  type: 'background-shell-ended',
  shellId,
  command: 'npm test',
  status: EShellStatus.Exited,
  exitCode: 0,
  output,
  droppedCharacters: 0,
  remainingCharacters: 0,
})

export const shellCutIds = (plan: ReturnType<typeof rewindPlan>): string[] =>
  plan.cuts.flatMap((cut) => (cut.kind === 'shell' ? [cut.shellId] : []))
