import type { CheckoutOption } from '../checkouts/checkout-options'

export enum EPaneOpen {
  Changes = 'changes',
  File = 'file',
  Context = 'context',
}

export type PaneOpenRequest = {
  kind: EPaneOpen
  path: string
  id: number
}

const CONTEXT_ENV_PREFIXES: readonly string[] = ['$ATLAS_CONTEXT_DIR/', '${ATLAS_CONTEXT_DIR}/']

const withoutTrailingSlashes = (path: string): string => path.replace(/\/+$/, '')

export const contextPathOf = (args: { path: string; sessionId: string }): string | undefined => {
  const prefix = CONTEXT_ENV_PREFIXES.find((candidate) => args.path.startsWith(candidate))
  if (prefix !== undefined) {
    const rest = args.path.slice(prefix.length)
    return rest === '' ? undefined : rest
  }
  const marker = `/sessions/${args.sessionId}/context/`
  const at = args.path.indexOf(marker)
  if (at === -1) return undefined
  const rest = args.path.slice(at + marker.length)
  return rest === '' ? undefined : rest
}

export const checkoutPathOf = (args: {
  path: string
  options: readonly CheckoutOption[]
  selectedId: string | undefined
}): { checkoutId: string; path: string } | undefined => {
  if (!args.path.startsWith('/')) {
    const relative = args.path.replace(/^\.\//, '')
    if (relative === '' || relative.startsWith('..') || args.selectedId === undefined)
      return undefined
    return { checkoutId: args.selectedId, path: relative }
  }
  const match = args.options
    .map((option) => ({ option, root: withoutTrailingSlashes(option.path) }))
    .filter(({ root }) => args.path === root || args.path.startsWith(`${root}/`))
    .sort((left, right) => right.root.length - left.root.length)[0]
  if (match === undefined) return undefined
  return { checkoutId: match.option.id, path: args.path.slice(match.root.length + 1) }
}
