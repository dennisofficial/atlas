import { Logger } from '@nestjs/common'
import { currentGithubCallSource } from './github-call-log'

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

export async function githubFetch(input: string, init?: RequestInit): Promise<Response> {
  const started = performance.now()
  const base = {
    source: currentGithubCallSource(),
    method: init?.method ?? 'GET',
    path: pathOf(input),
  }
  let response: Response
  try {
    response = await fetch(input, init)
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
