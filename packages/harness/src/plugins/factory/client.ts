import { z } from 'zod'

import { CloudTransport } from '../../cloud/cloud-transport'

export enum EStationKind {
  Implementer = 'implementer',
  Reviewer = 'reviewer',
}

export type GithubRef = { owner: string; repo: string; number: number }

const diffResponseSchema = z.strictObject({ diff: z.string() })

const segment = (value: string): string => encodeURIComponent(value)

const githubRef = (args: GithubRef): string =>
  `${segment(args.owner)}/${segment(args.repo)}/${args.number}`

export class FactoryClient {
  private readonly transport: CloudTransport

  constructor(args: {
    url: string
    token: string
    clientVersion?: string | undefined
    fetchFn?: typeof fetch | undefined
  }) {
    this.transport = new CloudTransport({
      url: args.url,
      token: args.token,
      ...(args.clientVersion === undefined ? {} : { clientVersion: args.clientVersion }),
      ...(args.fetchFn === undefined ? {} : { fetchFn: args.fetchFn }),
    })
  }

  reply(args: { surface: string; externalId: string; body: string }): Promise<unknown> {
    return this.transport.request({ method: 'POST', path: '/v1/factory/replies', body: args })
  }

  spawnStation(args: { kind: EStationKind; message: string }): Promise<unknown> {
    return this.transport.request({ method: 'POST', path: '/v1/factory/stations', body: args })
  }

  steerStation(args: { runId: string; message: string }): Promise<unknown> {
    return this.transport.request({
      method: 'POST',
      path: `/v1/factory/stations/${segment(args.runId)}/steer`,
      body: { message: args.message },
    })
  }

  stopStation(args: { runId: string }): Promise<unknown> {
    return this.transport.request({
      method: 'POST',
      path: `/v1/factory/stations/${segment(args.runId)}/stop`,
    })
  }

  deliver(args: { title: string; body: string }): Promise<unknown> {
    return this.transport.request({ method: 'POST', path: '/v1/factory/deliveries', body: args })
  }

  submitResult(args: { runId: string; result: Record<string, unknown> }): Promise<unknown> {
    return this.transport.request({
      method: 'POST',
      path: `/v1/factory/stations/${segment(args.runId)}/result`,
      body: { result: args.result },
    })
  }

  gitToken(args: { branch: string }): Promise<unknown> {
    return this.transport.request({ method: 'POST', path: '/v1/factory/git-token', body: args })
  }

  githubIssue(args: GithubRef): Promise<unknown> {
    return this.transport.request({
      method: 'GET',
      path: `/v1/factory/tools/github/issues/${githubRef(args)}`,
      retry: true,
    })
  }

  githubComments(args: GithubRef): Promise<unknown> {
    return this.transport.request({
      method: 'GET',
      path: `/v1/factory/tools/github/issues/${githubRef(args)}/comments`,
      retry: true,
    })
  }

  githubPullRequest(args: GithubRef): Promise<unknown> {
    return this.transport.request({
      method: 'GET',
      path: `/v1/factory/tools/github/pulls/${githubRef(args)}`,
      retry: true,
    })
  }

  async githubDiff(args: GithubRef): Promise<string> {
    const body = await this.transport.request({
      method: 'GET',
      path: `/v1/factory/tools/github/pulls/${githubRef(args)}/diff`,
      retry: true,
    })
    return diffResponseSchema.parse(body).diff
  }

  githubCloseIssue(args: GithubRef & { body: string }): Promise<unknown> {
    return this.transport.request({
      method: 'POST',
      path: `/v1/factory/tools/github/issues/${githubRef(args)}/close`,
      body: { body: args.body },
    })
  }

  githubAddLabel(args: GithubRef & { label: string }): Promise<unknown> {
    return this.transport.request({
      method: 'POST',
      path: `/v1/factory/tools/github/issues/${githubRef(args)}/labels`,
      body: { label: args.label },
    })
  }

  githubRemoveLabel(args: GithubRef & { label: string }): Promise<unknown> {
    return this.transport.request({
      method: 'DELETE',
      path: `/v1/factory/tools/github/issues/${githubRef(args)}/labels/${segment(args.label)}`,
    })
  }

  linearIssue(args: { issueId: string }): Promise<unknown> {
    return this.transport.request({
      method: 'GET',
      path: `/v1/factory/tools/linear/issues/${segment(args.issueId)}`,
      retry: true,
    })
  }

  linearComment(args: { issueId: string; body: string }): Promise<unknown> {
    return this.transport.request({
      method: 'POST',
      path: `/v1/factory/tools/linear/issues/${segment(args.issueId)}/comments`,
      body: { body: args.body },
    })
  }

  linearSetState(args: { issueId: string; stateName: string }): Promise<unknown> {
    return this.transport.request({
      method: 'POST',
      path: `/v1/factory/tools/linear/issues/${segment(args.issueId)}/state`,
      body: { stateName: args.stateName },
    })
  }

  linearMarkDuplicate(args: { issueId: string; duplicateOfId: string }): Promise<unknown> {
    return this.transport.request({
      method: 'POST',
      path: `/v1/factory/tools/linear/issues/${segment(args.issueId)}/duplicate`,
      body: { duplicateOfId: args.duplicateOfId },
    })
  }
}
