import { sanitizeRequestPath } from './request-path'
import type { ArtifactSpec } from './spec'
import { routeFilePathOf } from './storage-path'

export type RouteCandidate = { path: string; key: string }

export type RouteResolution = {
  candidates: readonly RouteCandidate[]
  notFound: RouteCandidate | null
}

const SHELL_PATH = 'index.html'

type RouteTree = { id: string; version: number }

const candidateOf = ({ tree, path }: { tree: RouteTree; path: string }): RouteCandidate => ({
  path,
  key: routeFilePathOf({ ...tree, path }),
})

const lastSegmentOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

const isRootPath = (pathname: string): boolean => pathname === '' || pathname === '/'

export function routeCandidatesOf(args: {
  id: string
  version: number
  pathname: string
  serve: ArtifactSpec['serve']
}): RouteResolution | null {
  const path = isRootPath(args.pathname) ? '' : sanitizeRequestPath(args.pathname)
  if (path === null) return null

  const tree: RouteTree = { id: args.id, version: args.version }
  const candidates: RouteCandidate[] = []
  const push = (candidatePath: string): void => {
    const candidate = candidateOf({ tree, path: candidatePath })
    if (candidates.some((existing) => existing.key === candidate.key)) return
    candidates.push(candidate)
  }

  push(path === '' ? SHELL_PATH : path)
  push(path === '' ? SHELL_PATH : `${path}/index.html`)

  if (args.serve.spa && !lastSegmentOf(path).includes('.')) push(SHELL_PATH)

  const notFoundPath =
    args.serve.notFound === undefined ? null : sanitizeRequestPath(args.serve.notFound)
  const notFound = notFoundPath === null ? null : candidateOf({ tree, path: notFoundPath })

  return { candidates, notFound }
}
