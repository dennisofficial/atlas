import { respond } from '../respond'
import type { ObjectFetcher, RouteObject, RouteObjectFetcher } from '../route-object'
import { storedObjectOf } from './fake-bucket'

export const ID = 'k7f2m9qxabcd'
export const HOST = `${ID}.byatlas.site`
export const DOMAIN = 'byatlas.site'

export type Fixture = { path: string; body: string }

export const fixtureOf = ({ path, body }: { path: string; body: string }): Fixture => ({
  path,
  body,
})

export const HTML = '<!doctype html><title>dashboard</title>'
export const APP_JS = 'console.log("app")'
export const MISSING_HTML = '<!doctype html><title>not found</title>'
export const DOCS_HTML = '<!doctype html><title>docs</title>'
export const STYLE_CSS = 'body { margin: 0 }'

const FIXTURES: Fixture[] = [
  fixtureOf({ path: 'index.html', body: HTML }),
  fixtureOf({ path: 'assets/app-1a2b3c4d.js', body: APP_JS }),
  fixtureOf({ path: 'docs/index.html', body: DOCS_HTML }),
  fixtureOf({ path: '404.html', body: MISSING_HTML }),
  fixtureOf({ path: 'style.css', body: STYLE_CSS }),
]

export const keyOf = (path: string): string => `artifacts/${ID}/_route/${path}`

export const routeOf = ({
  serve = { spa: false },
}: {
  serve?: RouteObject['serve']
} = {}): RouteObject => ({
  artifactId: 'art_1',
  subdomain: ID,
  name: 'Dashboard',
  serve,
})

export const stubs = ({
  route,
  files = FIXTURES,
}: {
  route?: RouteObject | null | undefined
  files?: Fixture[] | undefined
} = {}): {
  fetchRoute: RouteObjectFetcher
  fetchObject: ObjectFetcher
  labels: string[]
  keys: string[]
} => {
  const store = new Map(files.map((fixture) => [keyOf(fixture.path), fixture.body]))
  const labels: string[] = []
  const keys: string[] = []
  const resolved = route === undefined ? routeOf() : route
  return {
    labels,
    keys,
    fetchRoute: async (subdomain) => {
      labels.push(subdomain)
      return resolved
    },
    fetchObject: async (key) => {
      keys.push(key)
      const body = store.get(key)
      return body === undefined ? null : storedObjectOf(body)
    },
  }
}

export const requestOf = ({
  path = '/',
  method = 'GET',
  headers,
}: {
  path?: string
  method?: string
  headers?: Record<string, string> | undefined
} = {}): Request => new Request(`https://${HOST}${path}`, { method, headers: headers ?? {} })

export const serveWith = async ({
  path = '/',
  method = 'GET',
  route,
  files,
  host,
  headers,
}: {
  path?: string
  method?: string
  route?: RouteObject | null | undefined
  files?: Fixture[] | undefined
  host?: string
  headers?: Record<string, string> | undefined
} = {}): Promise<Response> => {
  const stubbed = stubs({ route, files })
  const request =
    host === undefined
      ? requestOf({ path, method, headers })
      : new Request(`http://localhost:3000${path}`, { method, headers: { host, ...headers } })
  return respond({
    request,
    domain: DOMAIN,
    fetchRoute: stubbed.fetchRoute,
    fetchObject: stubbed.fetchObject,
  })
}
