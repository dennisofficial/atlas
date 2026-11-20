import { describe, expect, it } from 'bun:test'

import { v2EventSchema } from '@dltech/atlas-core'
import { eventSchemaOf } from '@dltech/atlas-plugin-sdk'

import { registeredPlugins } from '../api/platform/control/registered-plugins'
import { triggerEventSchema } from './control-plane'

const mcpServerChanged = {
  id: 'thread-1:26',
  seq: 26,
  threadId: 'thread-1',
  runId: 'run-1',
  depth: 0,
  at: '2026-11-20T06:26:00.000Z',
  epoch: 1,
  prevHash: '0'.repeat(64),
  type: 'mcp-server-changed',
  row: {
    layer: 'project',
    name: 'storybook',
    reason: 'Unable to connect to the server',
    status: 'failed',
    toolCount: 0,
    transport: 'http',
  },
}

describe('the trigger worker event schema', () => {
  it('decodes the mcp roster events a pod writes', () => {
    expect(triggerEventSchema.safeParse(mcpServerChanged).success).toBe(true)
  })

  it('registers the same plugin bodies as the api host', () => {
    expect(triggerEventSchema.safeParse(mcpServerChanged)).toEqual(
      eventSchemaOf(registeredPlugins).safeParse(mcpServerChanged),
    )
  })

  it('is wider than the core-only schema that used to corrupt the read', () => {
    expect(v2EventSchema.safeParse(mcpServerChanged).success).toBe(false)
  })
})
