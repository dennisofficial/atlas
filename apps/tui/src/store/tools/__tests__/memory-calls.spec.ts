import { describe, expect, it } from 'bun:test'

import { sentenceOf } from '../aggregate'
import { classify } from '../classify'
import { EDetail, EGather, EToolClass } from '../kinds'
import { ECallState } from '../../tool-runs'
import { aCall, CWD } from './fixture'

const memoryOf = (args: {
  name: string
  input?: Record<string, unknown>
  output?: unknown
  state?: ECallState
}) =>
  classify({
    call: aCall({
      name: args.name,
      input: { scope: 'global', name: 'bun-deflate', ...args.input },
      output: args.output ?? {},
      state: args.state ?? ECallState.Ok,
    }),
    cwd: CWD,
  })

describe('read_memory', () => {
  it('is a recall named for the memory', () => {
    const reading = memoryOf({ name: 'read_memory', output: { lines: 12 } })

    expect(reading.gather).toBe(EGather.Recall)
    expect(reading.klass).toBe(EToolClass.Gathered)
    expect(reading.line).toBe('bun-deflate')
    expect(reading.alone).toBe('Recalled bun-deflate')
  })

  it('counts into the sentence as a memory', () => {
    const reads = ['a', 'b'].map((name) => ({
      call: aCall({ name: 'read_memory' }),
      reading: memoryOf({ name: 'read_memory', input: { name } }),
    }))

    expect(sentenceOf(reads)).toBe('Recalled 2 memories')
  })
})

describe('changing a memory', () => {
  it('remembers on write', () => {
    const reading = memoryOf({ name: 'write_memory' })

    expect(reading.klass).toBe(EToolClass.Change)
    expect(reading.line).toBe('Remembered bun-deflate')
    expect(reading.detail).toBe(EDetail.Created)
  })

  it('revises on edit', () => {
    expect(memoryOf({ name: 'edit_memory' }).line).toBe('Revised bun-deflate')
  })

  it('forgets on delete', () => {
    const reading = memoryOf({ name: 'delete_memory' })

    expect(reading.line).toBe('Forgot bun-deflate')
    expect(reading.note).toBe('forgotten')
  })

  it('does not name a memory that was refused', () => {
    const reading = memoryOf({ name: 'write_memory', state: ECallState.Failed })

    expect(reading.line).not.toContain('Remembered')
  })
})

describe('shell commands on a memory path', () => {
  it('are no longer treated as memory', () => {
    const reading = classify({
      call: aCall({
        name: 'bash',
        input: { command: 'rm /Users/d/.atlas/memory/x.md', description: 'Remove file' },
        output: { command: 'rm /Users/d/.atlas/memory/x.md', stdout: '', exitCode: 0 },
      }),
      cwd: CWD,
    })

    expect(reading.line).not.toContain('Forgot')
  })
})

describe('the browse clause', () => {
  it('reaches the sentence rather than vanishing from it', () => {
    const browsed = classify({
      call: aCall({
        name: 'web_fetch',
        input: { url: 'https://example.com/a' },
        output: { finalUrl: 'https://example.com/a' },
      }),
      cwd: CWD,
    })

    expect(sentenceOf([{ call: aCall({ name: 'web_fetch' }), reading: browsed }])).toBe(
      'Browsed 1 page',
    )
  })
})
