import { Logger } from '@nestjs/common'
import {
  EGithubCallLane,
  EGithubCallSource,
  githubCallLane,
  githubCredentialKind,
} from './github-call-log'
import { EGithubHttpCategory, type GithubRequestIdentity } from './github-request-coordinator.types'
import {
  takeGithubRequestSlot,
  blockGithubRequests,
  credentialFingerprint,
  githubCallCategory,
  recordGithubRateHeadroom,
  revokeGithubAccessGrant,
} from './github-request-budget'
import { rateLimitOfResponse } from './github-rate-limit'

const logger = new Logger('GithubCall')

function numberHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name)
  if (raw === null) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function pathOf(input: string): string {
  try {
    const url = new URL(input)
    return `${url.pathname}${url.search}`
  } catch {
    return 'invalid-url'
  }
}

function emit(line: Record<string, unknown>): void {
  try {
    logger.log(JSON.stringify(line))
  } catch {
    return
  }
}

function repoOf(path: string): string | undefined {
  const [, owner, repo] = /^\/repos\/([\w.-]+)\/([\w.-]+)(?:\/|$)/.exec(path) ?? []
  return owner === undefined || repo === undefined ? undefined : `${owner}/${repo}`
}

/**
 * GitHub answers 401 when the user's token expired and revoked it, and 403/404 on a repo the user
 * cannot read. Both end the access proof bought with that token; a rate-limit 403 does not.
 */
async function revokeOnCredentialFailure(args: {
  credentialFingerprint: string
  path: string
  status: number
}): Promise<void> {
  if (args.status === 401)
    return revokeGithubAccessGrant({ credentialFingerprint: args.credentialFingerprint })
  if (args.status !== 403 && args.status !== 404) return
  const repoFullName = repoOf(args.path)
  if (repoFullName === undefined) return
  await revokeGithubAccessGrant({
    credentialFingerprint: args.credentialFingerprint,
    repoFullName,
  })
}

export function githubCallIdentity(args: {
  source: EGithubCallSource
  url: string
  token: string
}): GithubRequestIdentity {
  const path = pathOf(args.url)
  return {
    credentialFingerprint: credentialFingerprint(args.token),
    resource: path.startsWith('/search/') ? 'search' : path === '/graphql' ? 'graphql' : 'core',
    category: githubCallCategory(
      args.source === EGithubCallSource.RepoAccess
        ? EGithubHttpCategory.Authorization
        : EGithubHttpCategory.Refresh,
    ),
    source: args.source,
    essential: githubCallLane(args.source) === EGithubCallLane.Essential,
  }
}

export async function githubFetch(args: {
  source: EGithubCallSource
  url: string
  init?: RequestInit
}): Promise<Response> {
  const { source, url, init } = args
  const token =
    new Headers(init?.headers).get('authorization')?.replace(/^Bearer\s+/i, '') ?? 'anonymous'
  const identity = githubCallIdentity({ source, url, token })
  init?.signal?.throwIfAborted()
  await takeGithubRequestSlot(identity)
  init?.signal?.throwIfAborted()
  const started = performance.now()
  const base = {
    source,
    method: init?.method ?? 'GET',
    path: pathOf(url),
    credentialFingerprint: identity.credentialFingerprint,
    credentialKind: githubCredentialKind(token),
  }
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (failure) {
    emit({
      ...base,
      status: 'error',
      error: failure instanceof Error ? failure.name : 'unknown',
      durationMs: Math.round(performance.now() - started),
    })
    throw failure
  }
  const headers = response.headers
  const observed = {
    ...identity,
    resource: headers.get('x-ratelimit-resource') ?? identity.resource,
  }
  await recordGithubRateHeadroom({
    identity: observed,
    remaining: numberHeader(headers, 'x-ratelimit-remaining'),
    limit: numberHeader(headers, 'x-ratelimit-limit'),
    reset: numberHeader(headers, 'x-ratelimit-reset'),
  })
  const limited = await rateLimitOfResponse(response)
  if (limited !== null)
    await blockGithubRequests({
      ...observed,
      until: Date.now() + limited.retryAfterSeconds * 1_000,
    })
  if (limited === null)
    await revokeOnCredentialFailure({
      credentialFingerprint: identity.credentialFingerprint,
      path: pathOf(url),
      status: response.status,
    })
  emit({
    ...base,
    status: response.status,
    durationMs: Math.round(performance.now() - started),
    rateResource: headers.get('x-ratelimit-resource'),
    rateUsed: numberHeader(headers, 'x-ratelimit-used'),
    rateRemaining: numberHeader(headers, 'x-ratelimit-remaining'),
    rateLimit: numberHeader(headers, 'x-ratelimit-limit'),
    rateReset: numberHeader(headers, 'x-ratelimit-reset'),
  })
  return response
}
