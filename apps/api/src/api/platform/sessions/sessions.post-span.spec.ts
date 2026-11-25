import { describe, expect, it } from 'bun:test'
import { NotFoundException } from '@nestjs/common'
import { ESpan } from '@dltech/atlas-observability'
import { RecordingTracer } from '@dltech/atlas-observability/testing'

import { setupSessionsService as setup } from './sessions.service.fixture'

describe('prompt post span', () => {
  it('times a post as its own root span, naming what it carried', async () => {
    const trace = new RecordingTracer()
    const { service } = setup({ traceFor: () => trace })
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a', title: 't' })

    await service.post({
      userId: 'user-a',
      sessionId: created.sessionId,
      text: 'hello',
      sentAt: new Date().toISOString(),
    })

    const spans = trace.named(ESpan.PromptPost)
    expect(spans).toHaveLength(1)
    expect(spans[0]?.parent).toBeUndefined()
    expect(spans[0]?.fields).toMatchObject({
      sessionId: created.sessionId,
      inboxId: 1,
      hasMedia: false,
    })
    expect(spans[0]?.fields.clientToApiMs).toBeGreaterThanOrEqual(0)
    expect(spans[0]?.ended).toBe(true)
  })

  it('keeps the client stamp out of the message the inbox receives', async () => {
    const trace = new RecordingTracer()
    const { service, plane } = setup({ traceFor: () => trace })
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a', title: 't' })

    const posted = await service.post({
      userId: 'user-a',
      sessionId: created.sessionId,
      text: 'hello',
      sentAt: new Date().toISOString(),
    })

    const [entry] = await plane.readInbox({
      sessionId: created.sessionId,
      afterId: posted.inboxId - 1,
      limit: 1,
    })
    expect(entry?.payload).not.toContain('sentAt')
  })

  it('drops the client stamp when the post carries none', async () => {
    const trace = new RecordingTracer()
    const { service } = setup({ traceFor: () => trace })
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a', title: 't' })

    await service.post({ userId: 'user-a', sessionId: created.sessionId, text: 'hello' })

    expect(trace.named(ESpan.PromptPost)[0]?.fields.clientToApiMs).toBeUndefined()
  })

  it('marks the span of a post that failed', async () => {
    const trace = new RecordingTracer()
    const { service } = setup({ traceFor: () => trace })

    await expect(
      service.post({ userId: 'user-a', sessionId: 'missing', text: 'hello' }),
    ).rejects.toBeInstanceOf(NotFoundException)

    expect(trace.named(ESpan.PromptPost)[0]?.errorClass).toBe('NotFoundException')
  })
})
