import type { FetchFn, GithubHttpResponse } from '../github/github-device-client'

export interface GithubCall {
  method: string
  url: string
  body?: string
}

export function response(args: { status: number; body?: unknown }): GithubHttpResponse {
  return {
    ok: args.status >= 200 && args.status < 300,
    status: args.status,
    text: async () => JSON.stringify(args.body ?? {}),
  }
}

export type GithubRoute = (call: GithubCall) => GithubHttpResponse | undefined

export function createFakeGithub() {
  const calls: GithubCall[] = []
  const overrides: GithubRoute[] = []
  const registered = new Map<number, string>()
  let nextId = 100

  const defaults: GithubRoute = (call) => {
    const path = call.url.replace('https://api.github.com', '')
    if (call.method === 'GET' && path === '/user') {
      return response({ status: 200, body: { id: 4242, login: 'octocat' } })
    }
    if (call.method === 'POST' && path === '/user/ssh_signing_keys') {
      const key = (JSON.parse(call.body ?? '{}') as { key: string }).key
      nextId += 1
      registered.set(nextId, key)
      return response({ status: 201, body: { id: nextId, key } })
    }
    if (call.method === 'DELETE') {
      registered.delete(Number(path.split('/').pop()))
      return response({ status: 204 })
    }
    return undefined
  }

  const fetchFn: FetchFn = async (url, request) => {
    const call: GithubCall = {
      method: request.method,
      url,
      ...(request.body === undefined ? {} : { body: request.body }),
    }
    calls.push(call)
    for (const route of overrides) {
      const answered = route(call)
      if (answered !== undefined) return answered
    }
    const answered = defaults(call)
    if (answered === undefined) throw new Error(`unexpected github call ${call.method} ${url}`)
    return answered
  }

  return {
    fetchFn,
    calls,
    registered,
    override: (route: GithubRoute) => {
      overrides.unshift(route)
    },
    reset: () => {
      calls.length = 0
      overrides.length = 0
      registered.clear()
      nextId = 100
    },
  }
}
