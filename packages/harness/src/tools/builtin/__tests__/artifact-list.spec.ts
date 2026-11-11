import { describe, expect, it } from 'bun:test'

import { toThreadId, type ToolDefinition, type ToolOutcome } from '@dltech/atlas-core'
import type { ArtifactSummary } from '@dltech/atlas-wire'

import { ArtifactUnavailable } from '../../../artifacts/artifact-port'
import { ListArtifactsTool } from '../artifact-list'
import { UnpublishArtifactTool } from '../artifact-unpublish'

import { FakeArtifactPort } from './artifact-fakes'

const summary: ArtifactSummary = {
  subdomain: 'demo',
  name: 'Demo',
  url: 'https://demo.artifacts.test',
  status: 'ready',
  updatedAt: '2026-11-09T10:00:00.000Z',
}

const invoke = async (input: Record<string, unknown>, tool: ToolDefinition) =>
  await tool.invoke({
    input,
    signal: new AbortController().signal,
    idempotencyKey: 'k',
    projectDirectory: '/ws',
    threadId: toThreadId('thr_1'),
  } as never)

const modelTextOf = (outcome: ToolOutcome): string => {
  if (!outcome.ok) throw new Error(outcome.reason)
  return outcome.modelText
}

describe('artifact_list', () => {
  it('renders an empty state rather than an empty table', async () => {
    const text = modelTextOf(await invoke({}, new ListArtifactsTool(new FakeArtifactPort())))

    expect(text).toContain('published no artifacts')
    expect(text).not.toContain('|')
  })

  it('renders a row per artifact with its URL, status and when it was last published', async () => {
    const port = new FakeArtifactPort()
    port.artifacts = [summary]

    const text = modelTextOf(await invoke({}, new ListArtifactsTool(port)))

    expect(text).toContain('name | url | status | updated')
    expect(text).toContain('Demo | https://demo.artifacts.test | ready | 2026-11-09T10:00:00.000Z')
    expect(text).toContain(summary.updatedAt)
  })

  it('turns a port error into prose rather than throwing', async () => {
    const port = new FakeArtifactPort()
    port.failure = new ArtifactUnavailable('sign in to Atlas Cloud to list artifacts')

    const outcome = await invoke({}, new ListArtifactsTool(port))

    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? '' : outcome.reason).toContain('sign in to Atlas Cloud')
  })
})

describe('artifact_unpublish', () => {
  it('unpublishes the slug it was given and says the URL is gone', async () => {
    const port = new FakeArtifactPort()

    const text = modelTextOf(await invoke({ slug: 'demo' }, new UnpublishArtifactTool(port)))

    expect(port.unpublishCalls).toEqual(['demo'])
    expect(text).toContain('demo is unpublished')
  })

  it('turns a port error into prose rather than throwing', async () => {
    const port = new FakeArtifactPort()
    port.failure = new ArtifactUnavailable('sign in to Atlas Cloud to unpublish an artifact')

    const outcome = await invoke({ slug: 'demo' }, new UnpublishArtifactTool(port))

    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? '' : outcome.reason).toContain('sign in to Atlas Cloud')
  })
})
