import type { EGithubPrStreamFrame, GithubPrStreamFrame } from '@dltech/atlas-wire'

export type SsePrFrame = Extract<
  GithubPrStreamFrame,
  { type: EGithubPrStreamFrame.PrState | EGithubPrStreamFrame.PrEvent }
>

export type SseHandlers = {
  onFrame: (frame: SsePrFrame) => void
  onDrop?: (() => void) | undefined
  onOpen?: (() => void | Promise<void>) | undefined
}

export class SseRefused extends Error {
  constructor(readonly status: number) {
    super(`the pull request stream answered ${status}`)
    this.name = 'SseRefused'
  }
}
