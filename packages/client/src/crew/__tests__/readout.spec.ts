import { describe, expect, it } from 'bun:test'

import { EAgentStatus, EShellStatus } from '@dltech/atlas-core'

import { crewActivityOf, shellBusyThreads } from '../activity'
import {
  contextTokensTone,
  crewRowReading,
  EContextTone,
  ESubagentReading,
  isSubagentWorking,
  subagentStateLabel,
} from '../readout'

const STARTED = '2026-01-01T00:00:00.000Z'
const NOW = Date.parse('2026-01-01T00:01:04.000Z')
const base = { startedAt: STARTED, endedAt: null }

describe('subagentStateLabel', () => {
  it('ticks elapsed while running', () => {
    expect(
      subagentStateLabel({
        subagent: { ...base, status: EAgentStatus.Running },
        now: NOW,
      }),
    ).toBe('1m 4s')
  })
  it('names a held child with its elapsed time', () => {
    expect(
      subagentStateLabel({
        subagent: { ...base, status: EAgentStatus.Blocked },
        now: NOW,
      }),
    ).toBe('blocked · 1m 4s')
  })
  it('says nothing for finished and names failures', () => {
    const ended = { ...base, endedAt: STARTED }
    expect(
      subagentStateLabel({
        subagent: { ...ended, status: EAgentStatus.Finished },
        now: NOW,
      }),
    ).toBe('')
    expect(
      subagentStateLabel({
        subagent: { ...ended, status: EAgentStatus.Failed },
        now: NOW,
      }),
    ).toBe('failed')
  })
  it('reads waiting, truncated by the injected function', () => {
    const subagent = {
      ...base,
      status: EAgentStatus.Finished,
      waitingOn: 'shell',
    }
    expect(subagentStateLabel({ subagent, now: NOW })).toBe('waiting on shell')
    expect(subagentStateLabel({ subagent, now: NOW, truncate: () => 'cut' })).toBe('cut')
  })
})

describe('crew reading', () => {
  it('lifts a settled child with activity to live', () => {
    const settled = { status: EAgentStatus.Finished }
    expect(crewRowReading(settled)).toBe(ESubagentReading.Settled)
    const busy = { ...settled, activity: { shells: 1, subagents: 0 } }
    expect(crewRowReading(busy)).toBe(ESubagentReading.Live)
    expect(isSubagentWorking(busy)).toBe(true)
  })
  it('tones context by absolute tokens', () => {
    expect(contextTokensTone(199_999)).toBe(EContextTone.Normal)
    expect(contextTokensTone(200_000)).toBe(EContextTone.Warn)
    expect(contextTokensTone(300_000)).toBe(EContextTone.Danger)
  })
})

describe('activity', () => {
  const rosters = {
    shells: [{ threadId: 'c', status: EShellStatus.Running }],
    children: [
      { agentId: 'c', spawnedBy: 'b', status: EAgentStatus.Finished },
      { agentId: 'b', spawnedBy: 'a', status: EAgentStatus.Finished },
    ],
  }
  it('is transitive through children', () => {
    expect(crewActivityOf({ id: 'a', rosters })).toEqual({
      shells: 0,
      subagents: 1,
    })
    expect(crewActivityOf({ id: 'c', rosters })).toEqual({
      shells: 1,
      subagents: 0,
    })
  })
  it('marks every ancestor of a shell holder busy', () => {
    expect([...shellBusyThreads(rosters)].sort()).toEqual(['a', 'b', 'c'])
  })
})
