import {
  EAgentStart,
  EAgentStatus,
  EDecision,
  EOperatorInputOutcome,
  ERunFailureKind,
  EShellStatus,
  EWorktreeExit,
  ETurnCause,
  ETurnEndedBy,
  ETurnOutcome,
  toCallId,
  type RecordEvent,
  type RecordEventBody,
} from '@dltech/atlas-core'

import { mintEvents } from './support'

export const EPISODES = 40

const episodeBodies = (index: number): RecordEventBody[] => {
  const turnId = `turn-${index}`
  const callId = toCallId(`call-${index}`)
  const shellId = `shell-${index % 3}`
  return [
    { type: 'turn-started', turnId, cause: ETurnCause.Input },
    { type: 'user-said', text: `message ${index}` },
    { type: 'tool-called', callId, name: 'read', ordinal: 0 },
    { type: 'tool-result', callId, name: 'read' },
    ...(index % 4 === 0
      ? ([
          { type: 'background-shell-started', shellId, command: 'bun dev' },
          {
            type: 'background-shell-matched',
            shellId,
            command: 'bun dev',
            pattern: 'up',
            lines: 'up',
            matchCount: 1,
          },
        ] as RecordEventBody[])
      : []),
    ...(index % 5 === 0
      ? ([
          {
            type: 'background-shell-ended',
            shellId,
            command: 'bun dev',
            status: EShellStatus.Exited,
            output: '',
            droppedCharacters: 0,
            remainingCharacters: 0,
          },
        ] as RecordEventBody[])
      : []),
    ...(index % 6 === 0
      ? ([
          {
            type: 'operator-input-requested',
            requestId: `request-${index}`,
            description: 'a code',
            path: 'code.txt',
          },
        ] as RecordEventBody[])
      : []),
    ...(index % 6 === 3
      ? ([
          {
            type: 'operator-input-resolved',
            requestId: `request-${index - 3}`,
            outcome: EOperatorInputOutcome.Delivered,
          },
        ] as RecordEventBody[])
      : []),
    ...(index % 7 === 0
      ? ([
          { type: 'approval-requested', callId: toCallId(`ask-${index}`), reason: 'run it' },
        ] as RecordEventBody[])
      : []),
    ...(index % 7 === 2
      ? ([
          {
            type: 'approval-answered',
            callId: toCallId(`ask-${index - 2}`),
            decision: EDecision.Allow,
          },
        ] as RecordEventBody[])
      : []),
    ...(index % 9 === 4
      ? ([
          { type: 'run-failed', failure: { kind: ERunFailureKind.Auth, message: 'signed out' } },
        ] as RecordEventBody[])
      : []),
    ...(index % 11 === 5
      ? ([{ type: 'input-refused', inboxId: index, reason: 'no' }] as RecordEventBody[])
      : []),
    ...(index % 8 === 1
      ? ([{ type: 'context-changed', paths: [`note-${index % 3}.md`] }] as RecordEventBody[])
      : []),
    ...(index % 13 === 7
      ? ([{ type: 'worktree-entered', path: `/tree-${index}`, branch: 'b' }] as RecordEventBody[])
      : []),
    ...(index % 13 === 11
      ? ([
          { type: 'worktree-exited', path: `/tree-${index - 4}`, action: EWorktreeExit.Keep },
        ] as RecordEventBody[])
      : []),
    ...(index % 10 === 8
      ? ([
          {
            type: 'agent-spawned',
            agentId: 'agent-1',
            agentType: 'explore',
            intent: 'look',
            mode: EAgentStart.Fresh,
          },
        ] as RecordEventBody[])
      : []),
    ...(index % 10 === 9
      ? ([
          {
            type: 'agent-ended',
            agentId: 'agent-1',
            agentType: 'explore',
            intent: 'look',
            status: EAgentStatus.Finished,
            prose: 'found it',
            turns: 1,
            toolCalls: 1,
          },
        ] as RecordEventBody[])
      : []),
    { type: 'assistant-said', parts: [{ type: 'text', text: `reply ${index}` }] },
    { type: 'turn-ended', turnId, outcome: ETurnOutcome.Completed, by: ETurnEndedBy.Agent },
  ]
}

export const logOf = (episodes: number): RecordEvent[] =>
  mintEvents({
    bodies: Array.from({ length: episodes }, (_, index) => episodeBodies(index)).flat(),
  })
