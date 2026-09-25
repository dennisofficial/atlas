import { describe, expect, it, vi } from 'vitest'
import type { GithubAppService } from '../reply/github-app.service'
import { EFactorySurface } from '../factory.types'
import { EStatusSignal, type StatusSignalRef } from './status-signal'
import { GithubStatusSignal } from './github-status-signal'

const ref: StatusSignalRef = {
  surface: EFactorySurface.GitHub,
  organizationId: 'org_1',
  externalId: 'compai/atlas#341',
  commentId: '9001',
}

describe('GithubStatusSignal', () => {
  const githubApp = {
    addCommentReactionForRepo: vi.fn(async () => ({ reactionId: 1 })),
    clearCommentReaction: vi.fn(async () => undefined),
  }
  const adapter = new GithubStatusSignal(githubApp as unknown as GithubAppService)

  it('sets the heard reaction as eyes on the comment', async () => {
    await adapter.set({ ref, signal: EStatusSignal.Heard })

    expect(githubApp.addCommentReactionForRepo).toHaveBeenCalledWith({
      owner: 'compai',
      repo: 'atlas',
      commentId: 9001,
      content: 'eyes',
    })
  })

  it('clears both lifecycle reactions on the comment', async () => {
    githubApp.clearCommentReaction.mockClear()
    await adapter.clear({ ref })

    expect(githubApp.clearCommentReaction).toHaveBeenCalledWith({
      owner: 'compai',
      repo: 'atlas',
      commentId: 9001,
      content: 'eyes',
    })
    expect(githubApp.clearCommentReaction).toHaveBeenCalledWith({
      owner: 'compai',
      repo: 'atlas',
      commentId: 9001,
      content: 'rocket',
    })
  })

  it('stands down on an unparseable ref instead of throwing', async () => {
    githubApp.addCommentReactionForRepo.mockClear()
    await adapter.set({ ref: { ...ref, externalId: 'not-a-github-ref' }, signal: EStatusSignal.Heard })
    expect(githubApp.addCommentReactionForRepo).not.toHaveBeenCalled()
  })
})
