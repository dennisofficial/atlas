import { CloudError } from '../../cloud/cloud-transport'
import type { CloudPullRequest, PullRequestsClient } from '../../cloud/pull-requests-client'

import {
  EChecksState,
  EForge,
  EPullRequestLookup,
  EPullRequestState,
  PullRequestPort,
  type ChecksTally,
  type PullRequest,
  type PullRequestReading,
  type RepositoryCheckout,
} from './pure'

const GITHUB_HOST = 'github.com'

const unavailable = (retryable: boolean): PullRequestReading => ({
  lookup: EPullRequestLookup.Unavailable,
  retryable,
})

const ABSENT: PullRequestReading = { lookup: EPullRequestLookup.Absent }

const PULL_REQUEST_STATES: Record<string, EPullRequestState> = {
  open: EPullRequestState.Open,
  draft: EPullRequestState.Draft,
  merged: EPullRequestState.Merged,
  closed: EPullRequestState.Closed,
}

const checksOf = (tally: ChecksTally): EChecksState => {
  if (tally.failed > 0) return EChecksState.Failing
  if (tally.running > 0) return EChecksState.Running
  if (tally.passed > 0) return EChecksState.Passing
  return EChecksState.None
}

const pullRequestOf = (dto: CloudPullRequest): PullRequest | null => {
  const state = PULL_REQUEST_STATES[dto.state]
  if (state === undefined) return null

  return {
    number: dto.number,
    title: dto.title,
    url: dto.url,
    state,
    checks: checksOf(dto.checks),
    tally: dto.checks,
  }
}

const ownerRepoOf = (linked: string): { owner: string; repo: string } | null => {
  const [host, owner, repo, ...extra] = linked.split('/')
  if (extra.length > 0 || host !== GITHUB_HOST || !owner || !repo) return null
  return { owner, repo }
}

/**
 * The cloud upstream of the pull request service: the API's webhook-fed cache answers, so a cloud
 * thread's chip and links never touch `gh`. Nothing throws out of `read` or `readLinked` — a 401
 * or 403 (github not connected, repo unreadable, sandbox token refused) does not fix itself on a
 * timer, so those read as non-retryable; everything else backs off and asks again.
 */
export class ApiPullRequestPort extends PullRequestPort {
  readonly pushes = false

  private readonly client: PullRequestsClient

  constructor(args: { client: PullRequestsClient }) {
    super()
    this.client = args.client
  }

  async read({ checkout }: { checkout: RepositoryCheckout }): Promise<PullRequestReading> {
    if (checkout.forge !== EForge.GitHub || checkout.remote.host !== GITHUB_HOST) {
      return unavailable(false)
    }

    return this.ask({
      ask: () =>
        this.client.byBranch({
          repo: `${checkout.remote.owner}/${checkout.remote.repo}`,
          branch: checkout.branch,
        }),
    })
  }

  async readLinked({
    repo,
    number,
  }: {
    repo: string
    number: number
  }): Promise<PullRequestReading> {
    const parsed = ownerRepoOf(repo)
    if (parsed === null) return unavailable(false)

    return this.ask({
      ask: () => this.client.byNumber({ repo: `${parsed.owner}/${parsed.repo}`, number }),
    })
  }

  private async ask(request: {
    ask: () => Promise<CloudPullRequest | null>
  }): Promise<PullRequestReading> {
    try {
      const dto = await request.ask()
      if (dto === null) return ABSENT

      const pullRequest = pullRequestOf(dto)
      if (pullRequest === null) return unavailable(true)

      return { lookup: EPullRequestLookup.Found, pullRequest }
    } catch (failure) {
      if (failure instanceof CloudError) {
        const settled = failure.status === 401 || failure.status === 403
        return unavailable(!settled)
      }
      return unavailable(true)
    }
  }
}
