import { Logger } from '@nestjs/common'
import type { EGithubCallSource } from './github-call-log'

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
