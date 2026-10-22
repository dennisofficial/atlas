const DEFAULT_LANE = 'postgresql://atlas:atlas@localhost:55441/atlas_test'
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])

export function laneUrl(): URL {
  const url = new URL(process.env.ATLAS_TEST_DATABASE_URL ?? DEFAULT_LANE)
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`test databases must be local; refusing ${url.hostname}`)
  }
  if (!url.pathname.slice(1).startsWith('atlas_test')) {
    throw new Error(`the test lane database must be named atlas_test*; got ${url.pathname.slice(1)}`)
  }
  return url
}

export function databaseUrl({ lane, name }: { lane: URL; name: string }): string {
  const url = new URL(lane)
  url.pathname = `/${name}`
  return url.toString()
}

export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}
