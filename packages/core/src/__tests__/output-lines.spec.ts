import { describe, expect, it } from 'bun:test'

import {
  CONSOLE_ARG_LIMIT,
  ESinkLevel,
  ESinkSource,
  SINK_TEXT_LIMIT,
  SINK_NOTICE_TEXT_LIMIT,
  consoleTextOf,
  sinkNoticeText,
  severityOfSink,
  truncateSinkText,
  warningTextOf,
} from '../sinks/output-lines'

describe('truncateSinkText', () => {
  it('flattens newlines so a multiline dump stays one log line', () => {
    expect(truncateSinkText({ text: 'one\ntwo\n' })).toBe('one ⏎ two ⏎')
  })

  it('truncates past the limit', () => {
    const long = 'x'.repeat(SINK_TEXT_LIMIT + 50)
    const out = truncateSinkText({ text: long })
    expect(out.length).toBe(SINK_TEXT_LIMIT + 1)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('consoleTextOf', () => {
  it('joins primitives and stringifies objects', () => {
    expect(consoleTextOf({ args: ['got', 3, { a: 1 }] })).toBe('got 3 {"a":1}')
  })

  it('renders an Error with its stack when present', () => {
    const error = new Error('boom')
    error.stack = 'STACK'
    expect(consoleTextOf({ args: [error] })).toBe('STACK')
  })

  it('caps the argument count and notes the remainder', () => {
    const args = Array.from({ length: CONSOLE_ARG_LIMIT + 2 }, (_, i) => `a${i}`)
    const out = consoleTextOf({ args })
    expect(out.endsWith('… +2 more')).toBe(true)
  })
})

describe('warningTextOf', () => {
  it('prefixes the warning type from an options object', () => {
    expect(warningTextOf({ warning: 'bad thing', options: { type: 'Warning' } })).toBe('[Warning] bad thing')
  })

  it('accepts a string type as the second argument', () => {
    expect(warningTextOf({ warning: 'bad thing', options: 'DeprecationWarning' })).toBe(
      '[DeprecationWarning] bad thing',
    )
  })

  it('renders an Error warning by its stack', () => {
    const error = new Error('bad thing')
    error.stack = 'STACK'
    expect(warningTextOf({ warning: error, options: undefined })).toBe('STACK')
  })
})

describe('severityOfSink', () => {
  it('maps console.log to info and process warnings to warn', () => {
    expect(
      severityOfSink({ entry: { level: ESinkLevel.Log, source: ESinkSource.Console, text: '' } }),
    ).toBe('info')
    expect(
      severityOfSink({ entry: { level: ESinkLevel.Log, source: ESinkSource.ProcessWarning, text: '' } }),
    ).toBe('warn')
  })
})

describe('sinkNoticeText', () => {
  it('retains the SDK model and cause without displaying a reasoning payload', () => {
    const warning = '[Warning] AI SDK Warning (openai / gpt-6.1-sol): Non-OpenAI reasoning parts are not supported.'
    expect(sinkNoticeText({ text: `${warning} Skipping reasoning part: {"text":"private thought"}` })).toBe(`${warning} …`)
  })

  it('limits visual text separately from diagnostic log text', () => {
    const text = 'x'.repeat(SINK_TEXT_LIMIT)
    expect(sinkNoticeText({ text })).toBe(`${'x'.repeat(SINK_NOTICE_TEXT_LIMIT)}…`)
    expect(truncateSinkText({ text })).toBe(text)
  })

  it('flattens whitespace into a readable preview', () => {
    expect(sinkNoticeText({ text: 'one\n\t two  three\r\n' })).toBe('one two three')
  })

  it('preserves short warnings verbatim', () => {
    expect(sinkNoticeText({ text: 'a package is unhappy' })).toBe('a package is unhappy')
  })
})
