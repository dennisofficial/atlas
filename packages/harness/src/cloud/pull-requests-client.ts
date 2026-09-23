import { z } from 'zod'

import { CloudTransport } from './cloud-transport'

export enum EPullRequestRoute {
  User = '/v1/github/prs',
  Sandbox = '/v1/sandboxes/github/prs',
}

export const cloudPullRequestSchema = z.strictObject({
  repoFullName: z.string().min(1),
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string().min(1),
  state: z.string().min(1),
  headBranch: z.string().min(1),
  headSha: z.string().min(1),
  checks: z.strictObject({
    running: z.number().int(),
    passed: z.number().int(),
    failed: z.number().int(),
  }),
  mergeable: z.boolean().nullable(),
  mergeableState: z.string().nullable(),
  updatedAt: z.string(),
})

export type CloudPullRequest = z.infer<typeof cloudPullRequestSchema>

export class PullRequestsClient {
  private readonly transport: CloudTransport
  private readonly route: EPullRequestRoute

  constructor(args: {
    url: string
    token: string
    route: EPullRequestRoute
    clientVersion?: string | undefined
    fetchFn?: typeof fetch | undefined
  }) {
    this.transport = new CloudTransport({
      url: args.url,
      token: args.token,
      ...(args.clientVersion === undefined ? {} : { clientVersion: args.clientVersion }),
      ...(args.fetchFn === undefined ? {} : { fetchFn: args.fetchFn }),
    })
    this.route = args.route
  }

  async byBranch(args: { repo: string; branch: string }): Promise<CloudPullRequest | null> {
    const body = await this.transport.request({
      method: 'GET',
      path: `${this.route}?repo=${encodeURIComponent(args.repo)}&branch=${encodeURIComponent(args.branch)}`,
      retry: true,
    })
    return body === undefined || body === null ? null : cloudPullRequestSchema.parse(body)
  }

  async byNumber(args: { repo: string; number: number }): Promise<CloudPullRequest | null> {
    const body = await this.transport.request({
      method: 'GET',
      path: `${this.route}?repo=${encodeURIComponent(args.repo)}&number=${args.number}`,
      retry: true,
    })
    return body === undefined || body === null ? null : cloudPullRequestSchema.parse(body)
  }
}
