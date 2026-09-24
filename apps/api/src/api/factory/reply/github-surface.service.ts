import { Injectable } from '@nestjs/common'
import { EnvService } from '../../../_core/config/env/env.service'
import { GithubApi, type GithubFetch } from './github-api'

const COMMENTS_CAP = 50
const DIFF_CAP = 50_000
const DIFF_TRUNCATED_MARKER = '\n\n[diff truncated at 50000 characters]'

class LabelAlreadyAbsent extends Error {}

type RepoRef = { owner: string; repo: string }
type IssueRef = RepoRef & { number: number }

export type IssueSummary = {
  number: number
  title: string
  body: string | null
  state: string
  labels: string[]
  url: string
}

export type IssueCommentSummary = {
  author: string
  body: string | null
  createdAt: string
}

export type PullRequestSummary = {
  number: number
  title: string
  body: string | null
  state: string
  draft: boolean
  headRef: string
  baseRef: string
  url: string
  changedFiles: number
  additions: number
  deletions: number
}

type GithubIssue = {
  number: number
  title: string
  body: string | null
  state: string
  labels: Array<{ name: string }>
  html_url: string
}

type GithubComment = {
  user: { login: string }
  body: string | null
  created_at: string
}

type GithubPullRequest = {
  number: number
  title: string
  body: string | null
  state: string
  draft: boolean
  head: { ref: string }
  base: { ref: string }
  html_url: string
  changed_files: number
  additions: number
  deletions: number
}

/** Read/write issue and pull-request surface for the factory tools API. */
@Injectable()
export class GithubSurfaceService {
  private readonly api: GithubApi

  constructor(env: EnvService, fetchFn?: GithubFetch) {
    this.api = new GithubApi(env, fetchFn)
  }

  async getIssue(args: IssueRef): Promise<IssueSummary> {
    const token = await this.token(args)
    const issue = await this.api.request<GithubIssue>({
      method: 'GET',
      path: this.issuePath(args),
      as: 'installation',
      token,
    })
    return {
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      labels: issue.labels.map((label) => label.name),
      url: issue.html_url,
    }
  }

  async getIssueComments(args: IssueRef): Promise<IssueCommentSummary[]> {
    const token = await this.token(args)
    const comments = await this.api.request<GithubComment[]>({
      method: 'GET',
      path: `${this.issuePath(args)}/comments?per_page=${COMMENTS_CAP}`,
      as: 'installation',
      token,
    })
    return comments.map((comment) => ({
      author: comment.user.login,
      body: comment.body,
      createdAt: comment.created_at,
    }))
  }

  async getPullRequest(args: IssueRef): Promise<PullRequestSummary> {
    const token = await this.token(args)
    const pr = await this.api.request<GithubPullRequest>({
      method: 'GET',
      path: this.pullPath(args),
      as: 'installation',
      token,
    })
    return {
      number: pr.number,
      title: pr.title,
      body: pr.body,
      state: pr.state,
      draft: pr.draft,
      headRef: pr.head.ref,
      baseRef: pr.base.ref,
      url: pr.html_url,
      changedFiles: pr.changed_files,
      additions: pr.additions,
      deletions: pr.deletions,
    }
  }

  async getPullRequestDiff(args: IssueRef): Promise<string> {
    const token = await this.token(args)
    const diff = await this.api.requestText({
      method: 'GET',
      path: this.pullPath(args),
      as: 'installation',
      token,
      accept: 'application/vnd.github.v3.diff',
    })
    if (diff.length <= DIFF_CAP) return diff
    return `${diff.slice(0, DIFF_CAP)}${DIFF_TRUNCATED_MARKER}`
  }

  /** Comments first so the close never lands without its explanation. */
  async closeIssue(args: IssueRef & { body: string }): Promise<{ url: string }> {
    const token = await this.token(args)
    await this.api.request<unknown>({
      method: 'POST',
      path: `${this.issuePath(args)}/comments`,
      as: 'installation',
      token,
      body: { body: args.body },
    })
    const issue = await this.api.request<{ html_url: string }>({
      method: 'PATCH',
      path: this.issuePath(args),
      as: 'installation',
      token,
      body: { state: 'closed' },
    })
    return { url: issue.html_url }
  }

  async addLabel(args: IssueRef & { label: string }): Promise<void> {
    const token = await this.token(args)
    await this.api.request<unknown>({
      method: 'POST',
      path: `${this.issuePath(args)}/labels`,
      as: 'installation',
      token,
      body: { labels: [args.label] },
    })
  }

  async removeLabel(args: IssueRef & { label: string }): Promise<void> {
    const token = await this.token(args)
    try {
      await this.api.request<unknown>({
        method: 'DELETE',
        path: `${this.issuePath(args)}/labels/${encodeURIComponent(args.label)}`,
        as: 'installation',
        token,
        onNotFound: () => {
          throw new LabelAlreadyAbsent()
        },
      })
    } catch (failure) {
      if (failure instanceof LabelAlreadyAbsent) return
      throw failure
    }
  }

  private token(args: RepoRef): Promise<string> {
    return this.api.installationToken({ owner: args.owner, repo: args.repo })
  }

  private issuePath(args: IssueRef): string {
    return `/repos/${args.owner}/${args.repo}/issues/${args.number}`
  }

  private pullPath(args: IssueRef): string {
    return `/repos/${args.owner}/${args.repo}/pulls/${args.number}`
  }
}
