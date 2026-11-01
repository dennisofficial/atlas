import { Logger } from '@nestjs/common'
import { EGithubCallSource } from './github-call-log'
import { EGithubHttpCategory } from './github-observation.types'
import {
  takeGithubRequestSlot,
  blockGithubRequests,
  credentialFingerprint,
} from './github-request-budget'
import { rateLimitOf } from './github-rate-limit'

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

export async function githubFetch(args: {
  source: EGithubCallSource
  url: string
  init?: RequestInit
}): Promise<Response> {
  const { source, url, init } = args
  const token =
    new Headers(init?.headers).get('authorization')?.replace(/^Bearer\s+/i, '') ?? 'anonymous'
  const identity = {
    credentialFingerprint: credentialFingerprint(token),
    resource: pathOf(url).startsWith('/search/')
      ? 'search'
      : pathOf(url) === '/graphql'
        ? 'graphql'
        : 'core',
    category:
      source === EGithubCallSource.RepoAccess
        ? EGithubHttpCategory.Authorization
        : EGithubHttpCategory.Refresh,
  }
  init?.signal?.throwIfAborted()
  await takeGithubRequestSlot(identity)
  init?.signal?.throwIfAborted()
  const started = performance.now()
  const base = {
    source,
    method: init?.method ?? 'GET',
    path: pathOf(url),
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
  const limited = rateLimitOf(response)
  if (limited !== null)
    await blockGithubRequests({
      ...identity,
      resource: response.headers.get('x-ratelimit-resource') ?? identity.resource,
      until: Date.now() + limited.retryAfterSeconds * 1_000,
    })
  const headers = response.headers
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
