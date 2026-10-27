import { splitPath, type ChangedFile } from '@dltech/atlas-ui/ai/changes-panel'

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

export function findChangedRow(args: { root: ParentNode; path: string }): Element | null {
  const { name, dir } = splitPath(args.path)
  for (const row of args.root.querySelectorAll('button[aria-expanded]')) {
    const label = row.children[1]
    const rowName = label?.children[0]?.textContent
    const rowDir = label?.children[1]?.textContent ?? ''
    if (rowName === name && rowDir === dir) return row
  }
  return null
}
