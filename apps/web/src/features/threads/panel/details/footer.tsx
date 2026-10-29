'use client'

import { useThreadPanel } from '../thread-panel-context'

export function DetailsFooter() {
  const { repoPath, worktreePath } = useThreadPanel().details
  if (repoPath === undefined && worktreePath === undefined) return null
  return (
    <footer className="flex shrink-0 flex-col gap-0.5 border-t px-3 py-2 font-mono text-xs text-muted-foreground">
      {repoPath === undefined ? null : (
        <p className="truncate" title={repoPath}>
          {repoPath}
        </p>
      )}
      {worktreePath === undefined ? null : (
        <p className="truncate" title={worktreePath}>
          {worktreePath}
        </p>
      )}
    </footer>
  )
}
