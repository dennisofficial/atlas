import { posix } from 'node:path'
import { parseLineSuffix } from '@dltech/atlas-core'

export enum EContextLink {
  External = 'external',
  SameDocument = 'same-document',
  Context = 'context',
  File = 'file',
}

export type ContextLinkRoute =
  | { kind: EContextLink.External }
  | { kind: EContextLink.SameDocument }
  | { kind: EContextLink.Context; path: string }
  | { kind: EContextLink.File; url: string }

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:\/\/|(?:https?|mailto|tel|sms|ftp|ssh|git|data|javascript):)/i

const FILE_SCHEME = 'file://'

function decode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function routeContextLink(args: { href: string; from: string }): ContextLinkRoute {
  const { href } = args
  if (EXTERNAL.test(href) || href.startsWith('//')) return { kind: EContextLink.External }

  const raw = href.split(/[?#]/, 1)[0] ?? ''
  if (raw.startsWith('/')) return { kind: EContextLink.File, url: `${FILE_SCHEME}${decode(raw)}` }

  const { path } = parseLineSuffix(decode(raw))
  if (path === '') return { kind: EContextLink.SameDocument }

  return {
    kind: EContextLink.Context,
    path: posix.normalize(posix.join(posix.dirname(args.from), path)),
  }
}
