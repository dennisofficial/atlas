import { posix } from 'node:path'

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

const SCHEME = /^[a-z][a-z0-9+.-]*:/i

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
  if (SCHEME.test(href) || href.startsWith('//')) return { kind: EContextLink.External }

  const target = decode(href.split(/[?#]/, 1)[0] ?? '')
  if (target.startsWith('/')) return { kind: EContextLink.File, url: `${FILE_SCHEME}${target}` }
  if (target === '') return { kind: EContextLink.SameDocument }

  return {
    kind: EContextLink.Context,
    path: posix.normalize(posix.join(posix.dirname(args.from), target)),
  }
}
