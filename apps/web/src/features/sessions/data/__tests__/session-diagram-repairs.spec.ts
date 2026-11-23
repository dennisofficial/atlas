import { describe, expect, it } from 'bun:test'

import { diagramKey, EAgentStatus, EDiagramRepair } from '@dltech/atlas-core'

import { ETranscriptKind, type TranscriptItem } from '@/features/threads/data/transcript-items'
import type { ReportItem, SpawnItem } from '@/features/threads/data/transcript-agents'

import { acceptedRepairsOf, withDiagramRepairs } from '../session-diagram-repairs'

const BROKEN = 'flowchart LR\n  A[Start --> B{Check'
const FIXED = 'flowchart LR\n  A[Start] --> B{Check}'

const fenced = (source: string) =>
  ['Before the diagram.', '', '```mermaid', source, '```'].join('\n')

const repairs = new Map([[diagramKey(BROKEN), FIXED]])

describe('acceptedRepairsOf', () => {
  it('keeps a repaired source the browser validated, keyed by its trimmed source', () => {
    const accepted = acceptedRepairsOf([
      {
        source: `  ${BROKEN}\n`,
        outcome: { kind: EDiagramRepair.Repaired, repaired: FIXED },
        valid: true,
      },
    ])

    expect(accepted.get(diagramKey(BROKEN))).toBe(FIXED)
    expect(accepted.size).toBe(1)
  })

  it('drops a repair that does not parse', () => {
    const accepted = acceptedRepairsOf([
      {
        source: BROKEN,
        outcome: { kind: EDiagramRepair.Repaired, repaired: FIXED },
        valid: false,
      },
    ])

    expect(accepted.size).toBe(0)
  })

  it('drops a stored failure', () => {
    const accepted = acceptedRepairsOf([
      {
        source: BROKEN,
        outcome: { kind: EDiagramRepair.Failed, reason: 'no diagram' },
        valid: true,
      },
    ])

    expect(accepted.size).toBe(0)
  })
})

describe('withDiagramRepairs', () => {
  const agent = (text: string, streaming = false): TranscriptItem => ({
    kind: ETranscriptKind.Agent,
    id: 'agent-1',
    text,
    streaming,
  })

  it('returns the same array when nothing is repaired', () => {
    const items: TranscriptItem[] = [agent(fenced(BROKEN))]

    expect(withDiagramRepairs({ items, repairs: new Map() })).toBe(items)
  })

  it('swaps the broken fence in a settled agent message', () => {
    const [item] = withDiagramRepairs({ items: [agent(fenced(BROKEN))], repairs })

    expect(item?.kind).toBe(ETranscriptKind.Agent)
    expect(item?.kind === ETranscriptKind.Agent ? item.text : '').toContain(FIXED)
    expect(item?.kind === ETranscriptKind.Agent ? item.text : '').not.toContain(BROKEN)
  })

  it('leaves a streaming message alone', () => {
    const [item] = withDiagramRepairs({ items: [agent(fenced(BROKEN), true)], repairs })

    expect(item?.kind === ETranscriptKind.Agent ? item.text : '').toContain(BROKEN)
  })

  it('repairs a sub-agent result and report as well', () => {
    const spawn: SpawnItem = {
      kind: ETranscriptKind.Spawn,
      id: 'spawn-1',
      agentId: 'agent-a',
      agentType: 'explore',
      intent: 'look',
      status: EAgentStatus.Done,
      result: fenced(BROKEN),
    }
    const report: ReportItem = {
      kind: ETranscriptKind.Report,
      id: 'report-1',
      agentId: 'agent-a',
      agentType: 'explore',
      intent: 'look',
      elapsed: '1s',
      failed: false,
      report: fenced(BROKEN),
    }

    const [nextSpawn, nextReport] = withDiagramRepairs({ items: [spawn, report], repairs })

    expect(nextSpawn?.kind === ETranscriptKind.Spawn ? nextSpawn.result : '').toContain(FIXED)
    expect(nextReport?.kind === ETranscriptKind.Report ? nextReport.report : '').toContain(FIXED)
  })

  it('leaves a message with no matching fence untouched', () => {
    const items: TranscriptItem[] = [agent('No diagram here.')]

    expect(withDiagramRepairs({ items, repairs })).toEqual(items)
  })
})
