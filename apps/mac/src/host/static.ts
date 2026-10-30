import { stat } from 'node:fs/promises'
import { isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { contentTypeFor } from './content-types'
import { placeholderLookup } from './fallback-routes'

const IMMUTABLE = 'public, max-age=31536000, immutable'

function safeDecode(pathname: string): string | undefined {
  try {
    const decoded = decodeURIComponent(pathname)
    return decoded.includes('\0') ? undefined : decoded
  } catch {
    return undefined
  }
}

function insideRoot({ root, relative }: { root: string; relative: string }): string | undefined {
  if (isAbsolute(relative)) return undefined
  const full = resolve(root, normalize(relative))
  return full === root || full.startsWith(root + sep) ? full : undefined
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function firstFile(paths: string[]): Promise<string | undefined> {
  for (const path of paths) {
    if (await isFile(path)) return path
  }
  return undefined
}

function candidates({ root, relative }: { root: string; relative: string }): string[] {
  const trimmed = relative.replace(/\/+$/, '')
  if (trimmed === '') return [join(root, 'index.html')]
  const base = insideRoot({ root, relative: trimmed })
  if (base === undefined) return []
  return [base, `${base}.html`, join(base, 'index.html')]
}

function fileResponse({
  path,
  status,
  pathname,
}: {
  path: string
  status: number
  pathname: string
}): Response {
  const headers = new Headers({ 'Content-Type': contentTypeFor(path) })
  const isHtml = path.endsWith('.html')
  if (isHtml) headers.set('Cache-Control', 'no-cache')
  else if (pathname.startsWith('/_next/static/')) headers.set('Cache-Control', IMMUTABLE)
  return new Response(Bun.file(path), { status, headers })
}

export async function serveStatic({
  webRoot,
  pathname,
}: {
  webRoot: string
  pathname: string
}): Promise<Response> {
  const root = resolve(webRoot)
  const decoded = safeDecode(pathname)
  if (decoded === undefined || decoded.split('/').includes('..') || decoded.includes('\\')) {
    return new Response('Bad Request', { status: 400 })
  }
  const relative = decoded.replace(/^\/+/, '')

  const direct = await firstFile(candidates({ root, relative }))
  if (direct) return fileResponse({ path: direct, status: 200, pathname: decoded })

  const placeholder = await placeholderLookup({
    root,
    segments: relative.replace(/\/+$/, '').split('/').filter(Boolean),
  })
  if (placeholder) {
    const path = join(root, ...placeholder)
    if (await isFile(path)) return fileResponse({ path, status: 200, pathname: decoded })
  }

  const notFound = join(root, '404.html')
  if (await isFile(notFound))
    return fileResponse({ path: notFound, status: 404, pathname: decoded })
  return new Response('Not Found', { status: 404 })
}
