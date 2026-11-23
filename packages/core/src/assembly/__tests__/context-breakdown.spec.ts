import { describe, expect, it } from 'bun:test'

import { contextBreakdownOf } from '../context-breakdown'

const sizesWith = (change: Record<string, number> = {}): Record<string, number> => ({
  'system.system-prompt': 60,
  'system.prompt.skills.listing': 20,
  'system.prompt.memory.instructions': 10,
  'tools.builtin': 90,
  messages: 100,
  'messages.context.user-instructions': 30,
  'messages.tool-results': 10,
  ...change,
})

describe('contextBreakdownOf', () => {
  it('splits the input tokens by character share and adds the output to the conversation', () => {
    const parts = contextBreakdownOf({
      sizes: sizesWith(),
      inputTokens: 100,
      outputTokens: 10,
    })

    expect(parts).toEqual([
      { label: 'System prompt', tokens: 12 },
      { label: 'Skills', tokens: 8 },
      { label: 'Memory', tokens: 4 },
      { label: 'Instructions', tokens: 12 },
      { label: 'Tools', tokens: 36 },
      { label: 'Tool results', tokens: 4 },
      { label: 'Conversation', tokens: 34 },
    ])
    expect(parts.reduce((total, part) => total + part.tokens, 0)).toBe(110)
  })

  it('takes the skills and memory fragments out of the system prompt row', () => {
    const parts = contextBreakdownOf({
      sizes: sizesWith({ 'tools.builtin': 0, messages: 60 }),
      inputTokens: 120,
      outputTokens: 0,
    })

    expect(parts).toEqual([
      { label: 'System prompt', tokens: 30 },
      { label: 'Skills', tokens: 20 },
      { label: 'Memory', tokens: 10 },
      { label: 'Instructions', tokens: 30 },
      { label: 'Tool results', tokens: 10 },
      { label: 'Conversation', tokens: 20 },
    ])
  })

  it('counts a skill loaded as context in the skills row, once', () => {
    const parts = contextBreakdownOf({
      sizes: {
        messages: 100,
        'messages.context.skill': 25,
      },
      inputTokens: 100,
      outputTokens: 0,
    })

    expect(parts).toEqual([
      { label: 'Skills', tokens: 25 },
      { label: 'Conversation', tokens: 75 },
    ])
  })

  it('gives one row per MCP server and ignores their tool counts', () => {
    const parts = contextBreakdownOf({
      sizes: {
        messages: 100,
        'tools.mcp.posthog': 25,
        'tools.mcp.posthog.count': 3,
        'tools.mcp.linear': 25,
        'tools.mcp.linear.count': 2,
      },
      inputTokens: 100,
      outputTokens: 0,
    })

    expect(parts).toEqual([
      { label: 'MCP: linear', tokens: 16 },
      { label: 'MCP: posthog', tokens: 16 },
      { label: 'Conversation', tokens: 68 },
    ])
  })

  it('hands the rounding remainder to the largest row so the rows sum exactly', () => {
    const parts = contextBreakdownOf({
      sizes: { 'tools.builtin': 1, 'tools.mcp.a': 1, 'tools.mcp.a.count': 1, messages: 1 },
      inputTokens: 100,
      outputTokens: 0,
    })

    expect(parts.reduce((total, part) => total + part.tokens, 0)).toBe(100)
    expect(parts[0]?.tokens).toBe(34)
    expect(parts[1]?.tokens).toBe(33)
    expect(parts[2]?.tokens).toBe(33)
  })

  it('keeps the conversation row when only the output carries tokens', () => {
    const parts = contextBreakdownOf({
      sizes: { 'tools.builtin': 10, messages: 0 },
      inputTokens: 0,
      outputTokens: 7,
    })

    expect(parts).toEqual([{ label: 'Conversation', tokens: 7 }])
  })

  it('returns nothing when no part has a measured character', () => {
    expect(contextBreakdownOf({ sizes: {}, inputTokens: 500, outputTokens: 5 })).toEqual([])
    expect(
      contextBreakdownOf({
        sizes: { messages: 0, 'tools.builtin': 0 },
        inputTokens: 500,
        outputTokens: 5,
      }),
    ).toEqual([])
  })

  it('omits a category that took none of the tokens', () => {
    const parts = contextBreakdownOf({
      sizes: { 'system.system-prompt': 10_000, messages: 1 },
      inputTokens: 10,
      outputTokens: 0,
    })

    expect(parts.map((part) => part.label)).toEqual(['System prompt'])
  })
})
