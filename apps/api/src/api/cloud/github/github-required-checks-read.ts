import type { EGithubCallSource } from './github-call-log'
import { githubFetch } from './github-fetch'
import {
  recalledRequiredContexts,
  rememberRequiredContexts,
  requiredContextsFrom,
  requiredContextsKey,
  type GithubPathRead,
  type RequiredContextsCache,
} from './github-required-checks'

const GITHUB_API = 'https://api.github.com'
const GITHUB_REQUEST_TIMEOUT_MS = 8_000

export type GithubRequiredContextsRead = {
  acquiredAt: Date
  requiredContexts: readonly string[] | null
}

export class GithubRequiredChecksRead {
  private readonly baseUrl = process.env.GITHUB_API_URL ?? GITHUB_API
  private readonly known: RequiredContextsCache = new Map()

  /**
   * Required contexts change with the branch's rulesets, not with the PR, so a short memory cache
   * keeps a webhook burst from spending one `rules/branches` call per fill.
   */
  async read(args: {
    source: EGithubCallSource
    token: string
    owner: string
    repo: string
    branch: string
  }): Promise<GithubRequiredContextsRead> {
    const key = requiredContextsKey(args)
    const startedAt = Date.now()
    const held = recalledRequiredContexts({ cache: this.known, key, now: startedAt })
    if (held !== undefined) {
      return { acquiredAt: new Date(held.acquiredAt), requiredContexts: held.contexts }
    }
    const contexts = await requiredContextsFrom({
      read: (path: string) => this.readPath({ source: args.source, token: args.token, path }),
      owner: args.owner,
      repo: args.repo,
      branch: args.branch,
    })
    if (contexts === null) {
      return { acquiredAt: new Date(startedAt), requiredContexts: null }
    }

    return {
      acquiredAt: new Date(startedAt),
      requiredContexts: rememberRequiredContexts({
        cache: this.known,
        acquiredAt: startedAt,
        contexts,
        key,
      }),
    }
  }

  private async readPath(args: {
    source: EGithubCallSource
    token: string
    path: string
  }): Promise<GithubPathRead> {
    const response = await githubFetch({
      source: args.source,
      url: `${this.baseUrl}${args.path}`,
      init: {
        headers: {
          authorization: `Bearer ${args.token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
        },
        signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
      },
    })
    if (!response.ok) return { status: response.status, body: null }
    return { status: response.status, body: await response.json() }
  }
}
