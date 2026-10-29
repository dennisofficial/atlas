export interface IFallbackRoute {
  pattern: RegExp
  target: (match: RegExpMatchArray) => string
}

export const FALLBACK_ROUTES: readonly IFallbackRoute[] = [
  { pattern: /^\/threads\/[^/]+\/?$/, target: () => 'threads/_' },
  { pattern: /^\/projects\/[^/]+\/settings\/?$/, target: () => 'projects/_/settings' },
  {
    pattern: /^\/projects\/[^/]+\/settings\/(mcp|overview|sandbox|secrets)\/?$/,
    target: (match) => `projects/_/settings/${match[1]}`,
  },
]

export function fallbackTargetFor(pathname: string): string | undefined {
  for (const route of FALLBACK_ROUTES) {
    const match = pathname.match(route.pattern)
    if (match) return route.target(match)
  }
  return undefined
}
