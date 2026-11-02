import type { ChangedFile } from '@dltech/atlas-ui/ai/changes-panel'

export function resolveChangedPath(args: {
  files: readonly ChangedFile[]
  path: string
}): string | undefined {
  const exact = args.files.find((file) => file.path === args.path)
  if (exact !== undefined) return exact.path
  return args.files.find((file) => args.path.endsWith(`/${file.path}`))?.path
}

export function withExpanded(args: { expanded: readonly string[]; path: string }): string[] {
  return args.expanded.includes(args.path) ? [...args.expanded] : [...args.expanded, args.path]
}

export function withoutCollapsedAncestors(args: {
  collapsed: readonly string[]
  path: string
}): string[] {
  return args.collapsed.filter((folder) => !args.path.startsWith(`${folder}/`))
}

export function findChangedRow(args: { root: ParentNode; path: string }): Element | null {
  for (const row of args.root.querySelectorAll('[data-changed-path]')) {
    if (row.getAttribute('data-changed-path') === args.path) return row
  }
  return null
}
