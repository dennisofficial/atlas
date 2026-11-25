import { describe, expect, it } from 'bun:test'

import {
  EInputConsumed,
  recordEventSchema,
  type ConsumedCommand,
  type RecordEvent,
} from '@dltech/atlas-core'

import { transcriptEventsOf } from '../../stream/transcript-events'
import { durableEntries } from '../durable-entries'
import { EEntryKind, type OperatorSaidEntry } from '../transcript-model'

let seq = 0

const envelope = () => {
  seq += 1
  return {
    id: `evt_${seq}`,
    seq,
    threadId: 'thr_main',
    runId: 'run_1',
    depth: 0,
    at: `2026-11-22T10:00:0${seq % 10}.000Z`,
    epoch: 0,
    prevHash: '0'.repeat(64),
  }
}

const consumed = (command: ConsumedCommand | undefined): RecordEvent =>
  recordEventSchema.parse({
    ...envelope(),
    type: 'input-consumed',
    inboxId: seq,
    consumed: EInputConsumed.Command,
    ...(command === undefined ? {} : { command }),
  })

const said = (text: string): RecordEvent =>
  recordEventSchema.parse({ ...envelope(), type: 'user-said', text })

const replied = (text: string): RecordEvent =>
  recordEventSchema.parse({
    ...envelope(),
    type: 'assistant-said',
    parts: [{ type: 'text', text }],
  })

const operatorEntries = (events: readonly RecordEvent[]): OperatorSaidEntry[] =>
  durableEntries({ events: transcriptEventsOf(events) }).filter(
    (entry): entry is OperatorSaidEntry => entry.kind === EEntryKind.OperatorSaid,
  )

const rename: ConsumedCommand = {
  name: 'rename',
  argumentText: 'bench',
  text: '/rename bench',
}

describe('a consumed command in the transcript', () => {
  it('keeps the typed line as the operator entry, marked with its command', () => {
    const entries = operatorEntries([consumed(rename), replied('Renamed')])

    expect(entries).toHaveLength(1)
    expect(entries[0]?.text).toBe('/rename bench')
    expect(entries[0]?.command).toEqual(rename)
  })

  it('keeps the command row at its place in the timeline', () => {
    const entries = durableEntries({
      events: transcriptEventsOf([said('one'), consumed(rename), replied('two')]),
    })

    expect(entries.map((entry) => entry.kind)).toEqual([
      EEntryKind.OperatorSaid,
      EEntryKind.OperatorSaid,
      EEntryKind.ModelSaid,
    ])
    expect(entries[1]?.key).toBeDefined()
  })

  it('drops an input-consumed event that carries no command', () => {
    expect(durableEntries({ events: transcriptEventsOf([consumed(undefined)]) })).toEqual([])
  })

  it('does not fold a command row into the message beside it', () => {
    const entries = operatorEntries([said('hello'), consumed(rename)])

    expect(entries).toHaveLength(2)
    expect(entries[0]?.command).toBeUndefined()
    expect(entries[1]?.command).toEqual(rename)
  })
})
