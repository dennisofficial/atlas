import { EPullRequestLookup, type PullRequest, type PullRequestReading } from './pure'

export type PolledPullRequest = { key: string; repo: string; pullRequest: PullRequest }

export function announcePolled(args: {
  listener: ((polled: PolledPullRequest) => void) | undefined
  key: string
  repo: string
  reading: PullRequestReading
}): void {
  if (args.listener === undefined || args.reading.lookup !== EPullRequestLookup.Found) return

  try {
    args.listener({ key: args.key, repo: args.repo, pullRequest: args.reading.pullRequest })
  } catch {
    return
  }
}
