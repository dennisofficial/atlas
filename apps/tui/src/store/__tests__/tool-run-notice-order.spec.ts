import { describe, expect, it } from 'bun:test'

import {
  EAgentRestart,
  EAgentStart,
  EAgentStatus,
  ECompactionAnchor,
  EExecutionLocation,
  EServiceStatus,
  EShellStatus,
  ETldrStatus,
  toThreadId,
  type EventDraft,
} from '@dltech/atlas-core'

import { deriveTranscript } from '../derive-transcript'
import { toolRuns } from '../tool-runs'
import { EEntryKind } from '../transcript-model'
import { log } from './fixture'
import { called, callId, result } from './tool-fixture'

const readCall = (n: number): EventDraft => called({ n, name: 'read' })
const readResult = (n: number): EventDraft => result({ n, name: 'read' })

const agentId = toThreadId('thread-sub-agent')

const subAgentEnded = (): EventDraft => ({
  type: 'agent-ended',
  agentId,
  agentType: 'builder',
  intent: 'audit the intake path',
  status: EAgentStatus.Finished,
  prose: 'the audit is done',
  turns: 3,
  toolCalls: 7,
})

const shellEnded = (): EventDraft => ({
  type: 'background-shell-ended',
  shellId: 'shell-1',
  command: 'bun test',
  status: EShellStatus.Exited,
  exitCode: 0,
  output: 'all green',
  droppedCharacters: 0,
  remainingCharacters: 0,
})

const shellAwaiting = (): EventDraft => ({
  type: 'background-shell-awaiting-input',
  shellId: 'shell-1',
  command: 'ssh prod',
  output: 'password:',
  droppedCharacters: 0,
  remainingCharacters: 0,
})

const shellMatched = (): EventDraft => ({
  type: 'background-shell-matched',
  shellId: 'shell-1',
  command: 'bun test',
  pattern: 'completed|ERROR',
  lines: 'completed 42 tests',
  matchCount: 1,
})

const shellCheckin = (): EventDraft => ({
  type: 'background-shell-still-running',
  shellId: 'shell-1',
  command: 'bun run dev',
  runningForMs: 300000,
  silentForMs: 60000,
  checkInMs: 300000,
  tail: 'listening on 3000',
})

const serviceEnded = (): EventDraft => ({
  type: 'service-ended',
  serviceId: 'svc-1',
  command: 'bun run dev',
  status: EServiceStatus.Exited,
  exitCode: 0,
  tail: 'shutting down',
})

const agentReported = (): EventDraft => ({
  type: 'agent-reported',
  agentId,
  agentType: 'teammate',
  intent: 'own the intake slice',
  prose: 'the work is done',
})

const agentRestarted = (via: EAgentRestart): EventDraft => ({
  type: 'agent-restarted',
  agentId,
  agentType: 'teammate',
  intent: 'own the intake slice',
  via,
})

const locationChanged = (): EventDraft => ({
  type: 'location-changed',
  from: EExecutionLocation.Host,
  to: EExecutionLocation.Docker,
})

const historyCompacted = (): EventDraft => ({
  type: 'history-compacted',
  anchor: ECompactionAnchor.Prefix,
  fromSeq: 1,
  throughSeq: 3,
  summary: 'earlier work was compacted',
  replaced: 12,
})

const tldrWritten = (): EventDraft => ({
  type: 'tldr-written',
  anchorSeq: 1,
  throughSeq: 2,
  text: 'tl;dr of the turn',
  modelId: 'model-1',
  status: ETldrStatus.Done,
})

const thinkingAlone = (): EventDraft => ({
  type: 'assistant-said',
  parts: [{ type: 'reasoning', text: 'mulling over the next call' }],
})

const keysOf = (drafts: readonly EventDraft[]) =>
  deriveTranscript({ events: log(drafts), signals: [] }).entries.map((entry) => entry.key)

describe('a visible notice between tool batches', () => {
  it('splits the run so calls before and after a sub-agent ending keep their order', () => {
    expect(keysOf([readCall(1), readResult(1), subAgentEnded(), readCall(2), readResult(2)])).toEqual([
      'tools:call-1',
      expect.any(String),
      'tools:call-2',
    ])
  })

  it('splits at every notice the transcript prints', () => {
    const notices = [
      shellEnded(),
      shellAwaiting(),
      shellMatched(),
      shellCheckin(),
      serviceEnded(),
      agentReported(),
      agentRestarted(EAgentRestart.Resume),
      locationChanged(),
      historyCompacted(),
    ]

    for (const notice of notices) {
      const runs = toolRuns(log([readCall(1), notice, readCall(2)]))
      expect({ notice: notice.type, runs: runs.length }).toEqual({ notice: notice.type, runs: 2 })
    }
  })

  it('does not split at bookkeeping the transcript never prints', () => {
    const invisible = [tldrWritten(), agentRestarted(EAgentRestart.Wake)]

    for (const event of invisible) {
      const runs = toolRuns(log([readCall(1), event, readCall(2)]))
      expect({ notice: event.type, runs: runs.length }).toEqual({ notice: event.type, runs: 1 })
    }
  })

  it('keeps thinking-only reasoning inside one run', () => {
    const runs = toolRuns(log([readCall(1), thinkingAlone(), readCall(2)]))

    expect(runs).toHaveLength(1)
    expect(runs[0]?.calls.map((call) => call.callId)).toEqual([callId(1), callId(2)])
  })

  it('keeps repeated notice waves in chronological order through deriveTranscript', () => {
    const drafts = [
      readCall(1),
      readResult(1),
      subAgentEnded(),
      readCall(2),
      readResult(2),
      subAgentEnded(),
      readCall(3),
      readResult(3),
    ]
    const model = deriveTranscript({ events: log(drafts), signals: [] })
    const kinds = model.entries.map((entry) => entry.kind)
    const keys = model.entries.map((entry) => entry.key)

    expect(kinds).toEqual([
      EEntryKind.ToolsRan,
      EEntryKind.AgentEnded,
      EEntryKind.ToolsRan,
      EEntryKind.AgentEnded,
      EEntryKind.ToolsRan,
    ])
    expect(keys.filter((key) => key.startsWith('tools:'))).toEqual([
      'tools:call-1',
      'tools:call-2',
      'tools:call-3',
    ])
  })
})
