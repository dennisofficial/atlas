import { describe, expect, it } from 'bun:test'

import { EToolKind, EToolState } from '@dltech/atlas-ui/ai/tool'

import { isSameItem } from '../same-item'
import {
  EToolFamily,
  ETranscriptKind,
  type ToolCallItem,
  type TranscriptItem,
} from '../transcript-items'

const agent = (overrides: Partial<Extract<TranscriptItem, { kind: ETranscriptKind.Agent }>> = {}) =>
  ({ kind: ETranscriptKind.Agent, id: 'a', text: 'hi', streaming: true, ...overrides }) as const

const call = (overrides: Partial<ToolCallItem> = {}): ToolCallItem => ({
  id: 'c1',
  kind: EToolKind.Shell,
  state: EToolState.Running,
  label: 'ls',
  ...overrides,
})

const tools = (calls: ToolCallItem[]): TranscriptItem => ({
  kind: ETranscriptKind.Tools,
  id: 't',
  calls,
})

describe('isSameItem', () => {
  it('treats an equal copy as the same', () => {
    expect(isSameItem({ previous: agent(), next: agent() })).toBe(true)
  })

  it('differs when text or streaming changes', () => {
    expect(isSameItem({ previous: agent(), next: agent({ text: 'hi!' }) })).toBe(false)
    expect(isSameItem({ previous: agent(), next: agent({ streaming: false }) })).toBe(false)
  })

  it('differs across kinds and ids', () => {
    const user: TranscriptItem = { kind: ETranscriptKind.User, id: 'a', text: 'hi' }
    expect(isSameItem({ previous: agent(), next: user })).toBe(false)
    expect(isSameItem({ previous: agent(), next: agent({ id: 'b' }) })).toBe(false)
    expect(isSameItem({ previous: agent(), next: agent({ at: '2026-10-22T10:00:01.000Z' }) })).toBe(
      false,
    )
  })

  it('compares each tool call field', () => {
    const base = tools([call()])
    expect(isSameItem({ previous: base, next: tools([call()]) })).toBe(true)
    for (const changed of [
      call({ state: EToolState.Done }),
      call({ label: 'pwd' }),
      call({ output: 'x' }),
      call({ errorText: 'boom' }),
      call({ elapsed: '1s' }),
      call({ id: 'c2' }),
      call({ title: 'Ran ls' }),
      call({ family: EToolFamily.Plan }),
      call({ at: '2026-10-22T10:00:01.000Z' }),
      call({ kind: EToolKind.Read }),
    ]) {
      expect(isSameItem({ previous: base, next: tools([changed]) })).toBe(false)
    }
    expect(isSameItem({ previous: base, next: tools([call(), call({ id: 'c2' })]) })).toBe(false)
  })
})
