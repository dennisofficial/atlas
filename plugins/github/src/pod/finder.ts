import { z } from 'zod'

const API_ROOT = 'https://api.github.com'

export type GithubTokenSource = { read(args: { userId: string }): Promise<string | null> }

export type FoundPullRequest = { number: number; url: string }

export type PullRequestFinder = {
  find(args: {
    repo: string
    branch: string
    signal: AbortSignal
  }): Promise<FoundPullRequest | null>
}

const pullsSchema = z.array(
  z.object({
    number: z.number().int().positive(),
    html_url: z.string().min(1),
    created_at: z.string().min(1),
  }),
)

export class GithubPullRequestFinder implements PullRequestFinder {
  constructor(
    private readonly args: {
      userId: string
      github: GithubTokenSource
      fetch?: typeof fetch | undefined
    },
  ) {}

  async find(args: {
    repo: string
    branch: string
    signal: AbortSignal
  }): Promise<FoundPullRequest | null> {
    const token = await this.args.github.read({ userId: this.args.userId })
    if (token === null) return null
    const [owner] = args.repo.split('/')
    const query = new URLSearchParams({ head: `${owner}:${args.branch}`, state: 'all' })
    const response = await (this.args.fetch ?? fetch)(
      `${API_ROOT}/repos/${args.repo}/pulls?${query.toString()}`,
      {
        signal: args.signal,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'x-github-api-version': '2022-11-28',
        },
      },
    )
    if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${args.repo}`)
    const pulls = pullsSchema.parse(await response.json())
    const newest = pulls.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0]
    return newest === undefined ? null : { number: newest.number, url: newest.html_url }
  }
}
