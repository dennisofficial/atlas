import { describe, expect, it, vi } from 'vitest'
import type { FactoryConnectionsService } from '../connections/connections.service'
import { EFactoryConnectionProvider, EFactorySurface } from '../factory.types'
import type { LinearTokensService } from '../linear/linear-tokens.service'
import { EStatusSignal, type StatusSignalRef } from './status-signal'

const { addCommentReaction, clearCommentReaction } = vi.hoisted(() => ({
  addCommentReaction: vi.fn(async () => ({ reactionId: 'reaction-1' })),
  clearCommentReaction: vi.fn(async () => undefined),
}))

vi.mock('../linear/linear-client', () => ({
  addCommentReaction,
  clearCommentReaction,
}))

import { LinearStatusSignal } from './linear-status-signal'

const ref: StatusSignalRef = {
  surface: EFactorySurface.Linear,
  organizationId: 'org_1',
  externalId: 'issue-uuid-1',
  commentId: 'comment-uuid-1',
}

describe('LinearStatusSignal', () => {
  const connections = {
    listForOrganization: vi.fn(async () => [
      { provider: EFactoryConnectionProvider.Linear, externalAccountId: 'workspace-1' },
    ]),
  }
  const linearTokens = { getToken: vi.fn(async () => 'lin_token') }
  const adapter = new LinearStatusSignal(
    connections as unknown as FactoryConnectionsService,
    linearTokens as unknown as LinearTokensService,
  )

  it('sets the heard emoji on the comment', async () => {
    await adapter.set({ ref, signal: EStatusSignal.Heard })

    expect(linearTokens.getToken).toHaveBeenCalledWith({ workspaceId: 'workspace-1' })
    expect(addCommentReaction).toHaveBeenCalledWith({
      token: 'lin_token',
      commentId: 'comment-uuid-1',
      emoji: '👀',
    })
  })

  it('clears both lifecycle emoji on the comment', async () => {
    clearCommentReaction.mockClear()
    await adapter.clear({ ref })

    expect(clearCommentReaction).toHaveBeenCalledWith({
      token: 'lin_token',
      commentId: 'comment-uuid-1',
      emoji: '👀',
    })
    expect(clearCommentReaction).toHaveBeenCalledWith({
      token: 'lin_token',
      commentId: 'comment-uuid-1',
      emoji: '🚀',
    })
  })

  it('stands down when the organization has no linear connection', async () => {
    connections.listForOrganization.mockResolvedValueOnce([])
    addCommentReaction.mockClear()

    await adapter.set({ ref, signal: EStatusSignal.Heard })

    expect(addCommentReaction).not.toHaveBeenCalled()
  })
})
