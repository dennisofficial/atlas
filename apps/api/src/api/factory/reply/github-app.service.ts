import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { EnvService } from '../../../_core/config/env/env.service'
import { GithubApi, type GithubFetch } from './github-api'

export { GithubAppNotInstalled } from './github-api'
export type { GithubFetch } from './github-api'

class BranchNotOnRemote extends Error {}

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

@Injectable()
export class GithubAppService {
  private readonly logger = new Logger(GithubAppService.name)
  private readonly api: GithubApi
  private bot: Promise<string | null> | null = null
  private slug: Promise<string> | null = null

  constructor(private readonly env: EnvService, fetchFn?: GithubFetch) {
    this.api = new GithubApi(env, fetchFn)
  }

  configured(): boolean {
    return this.api.configured()
  }

  /** Offline echo check: the webhook payload names the app that wrote the comment. */
  ownsAppId(id: number | undefined): boolean {
    if (id === undefined) return false
    return this.env.get('GITHUB_APP_ID') === String(id)
  }

  /**
   * The login our own comments arrive under on webhooks (`<slug>[bot]`); null when the app is not
   * configured, so ingress simply never filters. Cached per process; failures do not cache.
   */
  botLogin(): Promise<string | null> {
    this.bot ??= this.readBotLogin().catch((failure: unknown) => {
      this.bot = null
      this.logger.warn(`could not resolve the factory app bot login: ${messageOf(failure)}`)
      return null
    })
    return this.bot
  }

  /** The app's slug names its install page; cached per process, failures do not cache. */
  appSlug(): Promise<string> {
    this.slug ??= this.readAppSlug().catch((failure: unknown) => {
      this.slug = null
      throw failure
    })
    return this.slug
  }

  async assertInstallation(args: { installationId: string }): Promise<void> {
    await this.api.request<unknown>({
      method: 'GET',
      path: `/app/installations/${args.installationId}`,
      as: 'app',
      onNotFound: () => {
        throw new BadRequestException(
          `github installation ${args.installationId} does not exist for this app`,
        )
      },
    })
  }

  /** Minted per call on purpose: the installation token is the run-scoped credential. */
  installationToken(args: { owner: string; repo: string }): Promise<string> {
    return this.api.installationToken(args)
  }

  /** Adds 👀 — the intake acknowledgment that tells the labeler the factory has the item. */
  async addIssueReaction(args: {
    installationId: number
    repoFullName: string
    issueNumber: number
  }): Promise<void> {
    const token = await this.api.mintInstallationToken({ installationId: args.installationId })
    await this.api.request<unknown>({
      method: 'POST',
      path: `/repos/${args.repoFullName}/issues/${args.issueNumber}/reactions`,
      as: 'installation',
      token,
      body: { content: 'eyes' },
    })
  }

  /** A reaction on a comment — visible where the author is actually looking. */
  async addCommentReaction(args: {
    installationId: number
    repoFullName: string
    commentId: number
    content: string
  }): Promise<{ reactionId: number }> {
    const token = await this.api.mintInstallationToken({ installationId: args.installationId })
    const created = await this.api.request<{ id: number }>({
      method: 'POST',
      path: `/repos/${args.repoFullName}/issues/comments/${args.commentId}/reactions`,
      as: 'installation',
      token,
      body: { content: args.content },
    })
    return { reactionId: created.id }
  }

  /** Reactions delete by id, so the lifecycle holds the id the add returned. */
  async removeCommentReaction(args: {
    installationId: number
    repoFullName: string
    commentId: number
    reactionId: number
  }): Promise<void> {
    const token = await this.api.mintInstallationToken({ installationId: args.installationId })
    await this.api.requestText({
      method: 'DELETE',
      path: `/repos/${args.repoFullName}/issues/comments/${args.commentId}/reactions/${args.reactionId}`,
      as: 'installation',
      token,
    })
  }

  /** Repo-scoped add: resolves the installation from the repo so callers need no installation id. */
  async addCommentReactionForRepo(args: {
    owner: string
    repo: string
    commentId: number
    content: string
  }): Promise<{ reactionId: number }> {
    const token = await this.installationToken({ owner: args.owner, repo: args.repo })
    const created = await this.api.request<{ id: number }>({
      method: 'POST',
      path: `/repos/${args.owner}/${args.repo}/issues/comments/${args.commentId}/reactions`,
      as: 'installation',
      token,
      body: { content: args.content },
    })
    return { reactionId: created.id }
  }

  /**
   * Stateless clear: removes this app's reactions of one emoji from a comment by listing and
   * deleting, so the caller never tracks reaction ids. A reaction another author left is untouched.
   */
  async clearCommentReaction(args: {
    owner: string
    repo: string
    commentId: number
    content: string
  }): Promise<void> {
    const token = await this.installationToken({ owner: args.owner, repo: args.repo })
    const reactions = await this.api.request<Array<{ id: number; content: string }>>({
      method: 'GET',
      path: `/repos/${args.owner}/${args.repo}/issues/comments/${args.commentId}/reactions`,
      as: 'installation',
      token,
    })
    for (const reaction of reactions) {
      if (reaction.content !== args.content) continue
      await this.api.requestText({
        method: 'DELETE',
        path: `/repos/${args.owner}/${args.repo}/issues/comments/${args.commentId}/reactions/${reaction.id}`,
        as: 'installation',
        token,
      })
    }
  }

  /** Null when the branch is not on the remote — the delivery gate's "pushed" check. */
  async branchHead(args: { owner: string; repo: string; branch: string }): Promise<string | null> {
    const token = await this.installationToken({ owner: args.owner, repo: args.repo })
    try {
      const branch = await this.api.request<{ commit: { sha: string } }>({
        method: 'GET',
        path: `/repos/${args.owner}/${args.repo}/branches/${encodeURIComponent(args.branch)}`,
        as: 'installation',
        token,
        onNotFound: () => {
          throw new BranchNotOnRemote()
        },
      })
      return branch.commit.sha
    } catch (failure) {
      if (failure instanceof BranchNotOnRemote) return null
      throw failure
    }
  }

  /** Draft, always: ready-for-review is a human click, not a factory call. */
  async createPullRequest(args: {
    owner: string
    repo: string
    head: string
    base: string
    title: string
    body: string
  }): Promise<{ number: number; url: string }> {
    const token = await this.installationToken({ owner: args.owner, repo: args.repo })
    const pr = await this.api.request<{ number: number; html_url: string }>({
      method: 'POST',
      path: `/repos/${args.owner}/${args.repo}/pulls`,
      as: 'installation',
      token,
      body: {
        title: args.title,
        head: args.head,
        base: args.base,
        body: args.body,
        draft: true,
      },
    })
    return { number: pr.number, url: pr.html_url }
  }

  async createComment(args: {
    owner: string
    repo: string
    issueNumber: number
    body: string
  }): Promise<{ url: string }> {
    const token = await this.installationToken({ owner: args.owner, repo: args.repo })
    const comment = await this.api.request<{ html_url: string }>({
      method: 'POST',
      path: `/repos/${args.owner}/${args.repo}/issues/${args.issueNumber}/comments`,
      as: 'installation',
      token,
      body: { body: args.body },
    })
    return { url: comment.html_url }
  }

  private async readAppSlug(): Promise<string> {
    this.api.requireConfig()
    const app = await this.api.request<{ slug: string }>({
      method: 'GET',
      path: '/app',
      as: 'app',
    })
    return app.slug
  }

  private async readBotLogin(): Promise<string | null> {
    if (!this.configured()) return null
    const app = await this.api.request<{ slug: string }>({
      method: 'GET',
      path: '/app',
      as: 'app',
    })
    return `${app.slug}[bot]`.toLowerCase()
  }
}
