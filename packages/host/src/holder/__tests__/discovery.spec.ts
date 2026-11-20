import { describe, expect, it } from 'bun:test'

import { InMemoryToolRegistry } from '@dltech/atlas-agent'
import {
  CALL_TOOL_NAME,
  EToolEffect,
  TOOL_SEARCH_NAME,
  ToolDefinition,
  modelFacingDeclarationsOf,
  toThreadId,
  type ToolOutcome,
} from '@dltech/atlas-core'
import { z } from 'zod'

import { withDiscoveryTools } from '../discovery'

class ProbeTool extends ToolDefinition {
  readonly description: string
  readonly effect = EToolEffect.Read
  readonly inputSchema = z.object({})
  readonly deferred: true | undefined

  constructor(
    readonly name: string,
    deferred?: true,
  ) {
    super()
    this.description = `${name} probe`
    this.deferred = deferred
  }

  async invoke(): Promise<ToolOutcome> {
    return { ok: true, output: this.name, modelText: this.name }
  }
}

const registry = withDiscoveryTools(
  new InMemoryToolRegistry([new ProbeTool('read'), new ProbeTool('mcp__docs__search', true)]),
)

describe('the discovery tools on a pod registry', () => {
  it('lists tool_search and call_tool, and leaves the deferred tools out of the model-facing list', () => {
    expect(modelFacingDeclarationsOf(registry.declarations()).map((entry) => entry.name)).toEqual([
      'read',
      CALL_TOOL_NAME,
      TOOL_SEARCH_NAME,
    ])
  })

  it('keeps the deferred tool reachable for dispatch', () => {
    expect(registry.find('mcp__docs__search')?.name).toBe('mcp__docs__search')
  })

  it('answers tool_search with the deferred tools behind the registry', async () => {
    const outcome = await registry.find(TOOL_SEARCH_NAME)?.invoke({
      input: { query: 'docs' },
      signal: new AbortController().signal,
      idempotencyKey: 'k',
      projectDirectory: '/w',
      threadId: toThreadId('thread-1'),
    })

    expect(outcome).toMatchObject({
      ok: true,
      modelText: expect.stringContaining('mcp__docs__search'),
    })
  })
})
