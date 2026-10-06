export enum ELinkVerdict {
  Pass = 'pass',
  Handled = 'handled',
  Open = 'open',
}

export type LinkVerdict =
  | { kind: ELinkVerdict.Pass }
  | { kind: ELinkVerdict.Handled }
  | { kind: ELinkVerdict.Open; url: string }

export type LinkPoint = { x: number; y: number }

export type LinkScope = {
  contains: (point: LinkPoint) => boolean
  handle: (url: string) => LinkVerdict
}

const scopes: LinkScope[] = []

export function registerLinkScope(scope: LinkScope): () => void {
  scopes.push(scope)
  return () => {
    const index = scopes.indexOf(scope)
    if (index >= 0) scopes.splice(index, 1)
  }
}

export function linkScopeAt(point: LinkPoint): LinkScope | null {
  for (let index = scopes.length - 1; index >= 0; index -= 1) {
    const scope = scopes[index]
    if (scope?.contains(point)) return scope
  }
  return null
}
