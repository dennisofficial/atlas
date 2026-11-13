import { describe, expect, it } from 'bun:test'
import { toolNameOf } from '../event-tool-name'

describe('toolNameOf', () => {
  it('reads the tool name off a tool-called body', () => {
    expect(
      toolNameOf({
        type: 'tool-called',
        body: JSON.stringify({ name: 'skill', input: { name: 'review' } }),
      }),
    ).toBe('skill')
  })

  it('answers null for a type that is not tool-called', () => {
    expect(toolNameOf({ type: 'context-loaded', body: JSON.stringify({ name: 'skill' }) })).toBe(
      null,
    )
  })

  it('answers null when the body is not JSON', () => {
    expect(toolNameOf({ type: 'tool-called', body: 'not json at all' })).toBe(null)
  })

  it('answers null when the body carries no name', () => {
    expect(toolNameOf({ type: 'tool-called', body: JSON.stringify({ input: {} }) })).toBe(null)
  })

  it('answers null when the name is not a string', () => {
    expect(toolNameOf({ type: 'tool-called', body: JSON.stringify({ name: 7 }) })).toBe(null)
    expect(toolNameOf({ type: 'tool-called', body: JSON.stringify({ name: null }) })).toBe(null)
  })

  it('answers null for a body that is not a JSON object', () => {
    expect(toolNameOf({ type: 'tool-called', body: '[]' })).toBe(null)
    expect(toolNameOf({ type: 'tool-called', body: 'null' })).toBe(null)
    expect(toolNameOf({ type: 'tool-called', body: '"skill"' })).toBe(null)
  })
})
