import type { ManifestEntry } from './manifest'
import type { ArtifactSpec } from './spec'

export type Resolution =
  | { kind: 'file'; entry: ManifestEntry }
  | { kind: 'notFound'; status: 404; entry?: ManifestEntry }

const decodePathname = (pathname: string): string | null => {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const segments = decoded.split('/').filter((segment) => segment !== '' && segment !== '.')
  if (segments.some((segment) => segment === '..')) return null
  return `/${segments.join('/')}`
}

const lastSegmentOf = (pathname: string): string => pathname.slice(pathname.lastIndexOf('/') + 1)

export function resolveRequest(args: {
  pathname: string
  files: ReadonlyMap<string, ManifestEntry>
  serve: ArtifactSpec['serve']
}): Resolution {
  const pathname = decodePathname(args.pathname)
  if (pathname === null) return { kind: 'notFound', status: 404 }

  const relative = pathname.replace(/^\//, '')
  const exact = args.files.get(relative)
  if (exact !== undefined) return { kind: 'file', entry: exact }

  if (pathname.endsWith('/')) {
    const index = args.files.get(`${relative}index.html`)
    if (index !== undefined) return { kind: 'file', entry: index }
  }

  const nested = args.files.get(relative === '' ? 'index.html' : `${relative}/index.html`)
  if (nested !== undefined) return { kind: 'file', entry: nested }

  const lastSegment = lastSegmentOf(pathname)
  if (args.serve.spa && !lastSegment.includes('.')) {
    const shell = args.files.get('index.html')
    if (shell !== undefined) return { kind: 'file', entry: shell }
  }

  if (args.serve.notFound !== undefined) {
    const entry = args.files.get(args.serve.notFound)
    if (entry !== undefined) return { kind: 'notFound', status: 404, entry }
  }

  return { kind: 'notFound', status: 404 }
}
