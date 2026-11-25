import { EGithubPrStreamFrame, type GithubPrStreamFrame } from '@dltech/atlas-wire'
import { describe } from 'bun:test'

const _consume = (frames: AsyncGenerator<GithubPrStreamFrame>) => {
  const seen: GithubPrStreamFrame[] = []
  const finished = (async () => {
    for await (const frame of frames) seen.push(frame)
  })()
  return { seen, finished }
}

const _events = (seen: readonly GithubPrStreamFrame[]) =>
  seen.flatMap((frame) => (frame.type === EGithubPrStreamFrame.PrEvent ? [frame.event.id] : []))

describe('GithubPrStreamRouter.stream for a thread-bound pod', () => {})
