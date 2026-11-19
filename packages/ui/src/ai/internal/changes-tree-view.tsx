import { ChevronRightIcon, FolderIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '#lib/utils'
import { Counts } from './changes-format'
import { FileRow } from './changes-file-row'
import type { ChangeDirNode, ChangeTreeNode } from './changes-tree'
import type { ChangedFile } from './changes-types'
import { TreeGuideCells } from './tree-guide'

interface TreeViewProps {
  nodes: ChangeTreeNode[]
  expanded: string[]
  collapsed: string[]
  onToggleFile: (path: string) => void
  onToggleFolder: (path: string) => void
  renderDiff?: (file: ChangedFile) => ReactNode
}

interface ChangeTreeRow {
  node: ChangeTreeNode
  depth: number
}

export function visibleChangeRows(args: {
  nodes: ChangeTreeNode[]
  collapsed: string[]
  depth?: number
}): ChangeTreeRow[] {
  const depth = args.depth ?? 0
  return args.nodes.flatMap((node) => {
    const row = { node, depth }
    if (node.kind === 'file' || args.collapsed.includes(node.path)) return [row]
    return [
      row,
      ...visibleChangeRows({ nodes: node.children, collapsed: args.collapsed, depth: depth + 1 }),
    ]
  })
}

function FolderRow(args: {
  node: ChangeDirNode
  open: boolean
  depth: number
  onToggle: (path: string) => void
}) {
  const { node, open, depth, onToggle } = args
  const handleToggle = () => onToggle(node.path)

  return (
    <li className="flex flex-col">
      <div className="flex">
        <TreeGuideCells depth={depth} />
        <button
          type="button"
          aria-expanded={open}
          data-changed-folder={node.path}
          onClick={handleToggle}
          className={cn(
            'flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1.5 pr-3 pl-3 text-left text-sm outline-none',
            'hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset',
          )}
        >
          <ChevronRightIcon
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90',
            )}
          />
          <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-foreground">{node.name}</span>
          <Counts added={node.added} removed={node.removed} />
        </button>
      </div>
    </li>
  )
}

export function ChangesTreeView({
  nodes,
  expanded,
  collapsed,
  onToggleFile,
  onToggleFolder,
  renderDiff,
}: TreeViewProps) {
  return (
    <ul className="flex flex-col">
      {visibleChangeRows({ nodes, collapsed }).map(({ node, depth }) =>
        node.kind === 'dir' ? (
          <FolderRow
            key={`dir:${node.path}`}
            node={node}
            open={!collapsed.includes(node.path)}
            depth={depth}
            onToggle={onToggleFolder}
          />
        ) : (
          <FileRow
            key={node.file.path}
            file={node.file}
            open={expanded.includes(node.file.path)}
            onToggle={onToggleFile}
            showDir={false}
            depth={depth}
            renderDiff={renderDiff}
          />
        ),
      )}
    </ul>
  )
}
