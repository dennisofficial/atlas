import { describe, expect, it } from 'bun:test'

import { mcpHueOf, mcpToolOf, serverLabelOf, toolLabelOf } from '../mcp'

describe('reading an MCP tool name', () => {
  it('splits the server from the tool', () => {
    expect(mcpToolOf('mcp__paper__get_guide')).toEqual({ server: 'paper', tool: 'get_guide' })
  })

  it('keeps a hyphenated server whole', () => {
    expect(mcpToolOf('mcp__wispr-flow__search_meetings')).toEqual({
      server: 'wispr-flow',
      tool: 'search_meetings',
    })
  })

  it('takes everything after the second separator as the tool', () => {
    expect(mcpToolOf('mcp__fs__read__file')).toEqual({ server: 'fs', tool: 'read__file' })
  })

  it('refuses a name that is not an MCP call', () => {
    expect(mcpToolOf('read')).toBeNull()
    expect(mcpToolOf('mcp_underscored__read')).toBeNull()
  })

  it('refuses a name with no tool after the server', () => {
    expect(mcpToolOf('mcp__paper__')).toBeNull()
    expect(mcpToolOf('mcp__paper')).toBeNull()
  })
})

describe('the words a row shows', () => {
  it('title-cases each word of a server handle', () => {
    expect(serverLabelOf('wispr-flow')).toBe('Wispr Flow')
    expect(serverLabelOf('paper')).toBe('Paper')
    expect(serverLabelOf('google_calendar')).toBe('Google Calendar')
  })

  it('leaves a name that already carries its capitals alone', () => {
    expect(serverLabelOf('Posthog')).toBe('Posthog')
  })

  it('leads the tool name with a capital and keeps the rest as written', () => {
    expect(toolLabelOf('get_basic_info')).toBe('Get basic info')
    expect(toolLabelOf('search_meetings')).toBe('Search meetings')
    expect(toolLabelOf('exec')).toBe('Exec')
  })
})

describe('the hue a server keeps', () => {
  it('stays inside the colour wheel', () => {
    for (const server of ['paper', 'wispr-flow', 'posthog', '', 'a'.repeat(200)]) {
      const hue = mcpHueOf(server)
      expect(Number.isInteger(hue)).toBe(true)
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
    }
  })

  it('gives the same server the same hue every time', () => {
    expect(mcpHueOf('paper')).toBe(mcpHueOf('paper'))
  })

  it('gives different servers different hues', () => {
    expect(mcpHueOf('paper')).not.toBe(mcpHueOf('posthog'))
    expect(mcpHueOf('linear')).not.toBe(mcpHueOf('github'))
  })
})
