import { describe, expect, it } from 'bun:test'

import { McpBridgeTool } from '../bridge-tool'

describe('a bridge tool', () => {
  it('is always deferred', () => {
    const tool = new McpBridgeTool({
      server: 'docs',
      info: { name: 'search' },
      caller: () => undefined,
    })

    expect(tool.deferred).toBe(true)
  })
})
