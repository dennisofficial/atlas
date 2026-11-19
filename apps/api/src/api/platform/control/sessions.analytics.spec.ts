import { describe, expect, it } from 'bun:test'
import { ProductAnalytics } from '@dltech/atlas-observability'

import { setupSessionsService as setup } from './sessions.service.fixture'

type Captured = { userId: string; event: string; properties: Record<string, unknown> }

class FakeAnalytics extends ProductAnalytics {
  readonly captured: Captured[] = []

  capture(args: { userId: string; event: string; properties?: Record<string, unknown> }): void {
    this.captured.push({
      userId: args.userId,
      event: args.event,
      properties: args.properties ?? {},
    })
  }

  async flush(): Promise<void> {}
}

const withAnalytics = () => {
  const analytics = new FakeAnalytics()
  return { ...setup({ analytics }), analytics }
}

describe('SessionsService analytics', () => {
  it('reports session_created with the model, provider and first-message flag', async () => {
    const { analytics, service } = withAnalytics()

    await service.create({
      userId: 'user-a',
      projectId: 'proj-a',
      model: 'anthropic/claude-opus-5-5',
      provider: 'vercel',
      firstMessage: { text: 'hi' },
    })

    expect(analytics.captured).toHaveLength(1)
    expect(analytics.captured[0]).toMatchObject({
      userId: 'user-a',
      event: 'session_created',
      properties: {
        project_id: 'proj-a',
        model: 'anthropic/claude-opus-5-5',
        provider: 'vercel',
        has_first_message: true,
        spawned: false,
      },
    })
  })

  it('reports session_archived and session_unarchived', async () => {
    const { analytics, service } = withAnalytics()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

    await service.archive({ userId: 'user-a', sessionId: created.sessionId, archived: true })
    await service.archive({ userId: 'user-a', sessionId: created.sessionId, archived: false })

    expect(analytics.captured.slice(1).map((entry) => entry.event)).toEqual([
      'session_archived',
      'session_unarchived',
    ])
    expect(analytics.captured[1]?.properties.session_id).toBe(created.sessionId)
  })

  it('reports model_changed after the model-set command', async () => {
    const { analytics, service } = withAnalytics()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

    await service.command({
      userId: 'user-a',
      sessionId: created.sessionId,
      name: 'model-set',
      args: { model: 'anthropic/claude-opus-5-5', effort: 'high', fast: true },
    })

    expect(analytics.captured.at(-1)).toMatchObject({
      event: 'model_changed',
      properties: {
        session_id: created.sessionId,
        model: 'anthropic/claude-opus-5-5',
        effort: 'high',
        fast: true,
      },
    })
  })
})
