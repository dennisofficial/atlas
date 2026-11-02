import { ChevronRightIcon, FolderIcon } from 'lucide-react'

import { cn } from '#lib/utils'
import { Counts } from './changes-format'
import { FileRow, ROW_INDENT_REM } from './changes-file-row'
import type { ChangeDirNode, ChangeTreeNode } from './changes-tree'

interface TreeViewProps {
  nodes: ChangeTreeNode[]
  expanded: string[]
  collapsed: string[]
  onToggleFile: (path: string) => void
  onToggleFolder: (path: string) => void
  depth?: number
}

interface FolderRowProps extends Omit<TreeViewProps, 'nodes'> {
  node: ChangeDirNode
}

function FolderRow({ node, collapsed, depth = 0, ...rest }: FolderRowProps) {
  const open = !collapsed.includes(node.path)
  const handleToggle = () => rest.onToggleFolder(node.path)

  return (
    <li className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        data-changed-folder={node.path}
        onClick={handleToggle}
        style={{ paddingLeft: `${0.75 + depth * ROW_INDENT_REM}rem` }}
        className={cn(
          'flex w-full min-w-0 cursor-pointer items-center gap-2 py-1.5 pr-3 text-left text-sm outline-none',
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
      {open ? (
        <ChangesTreeView {...rest} nodes={node.children} collapsed={collapsed} depth={depth + 1} />
      ) : null}
    </li>
  )
}

export function ChangesTreeView({
  nodes,
  expanded,
  collapsed,
  onToggleFile,
  onToggleFolder,
  depth = 0,
}: TreeViewProps) {
  return (
    <ul className="flex flex-col">
      {nodes.map((node) =>
        node.kind === 'dir' ? (
          <FolderRow
            key={`dir:${node.path}`}
            node={node}
            expanded={expanded}
            collapsed={collapsed}
            onToggleFile={onToggleFile}
            onToggleFolder={onToggleFolder}
            depth={depth}
          />
        ) : (
          <FileRow
            key={node.file.path}
            file={node.file}
            open={expanded.includes(node.file.path)}
            onToggle={onToggleFile}
            showDir={false}
            depth={depth}
          />
        ),
      )}
    </ul>
  )
}
