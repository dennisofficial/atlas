'use client'

import { GitBranchIcon } from 'lucide-react'

import { useThreadPanel } from '../thread-panel-context'
import { PullRequestRowItem } from './pull-request-row'
import { DetailsSection } from './section'

export function GithubSection() {
  const { details } = useThreadPanel()
  const { branch, pullRequests } = details
  if (branch === undefined && pullRequests.rows.length === 0) return null

  return (
    <DetailsSection title="GitHub">
      {branch === undefined ? null : (
        <p className="flex min-w-0 items-center gap-2 px-1 font-mono text-xs text-muted-foreground">
          <GitBranchIcon aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{branch}</span>
        </p>
      )}
      {pullRequests.rows.map((row) => (
        <PullRequestRowItem
          key={row.key}
          row={row}
          bell={pullRequests.bells[row.key]}
          onToggleBell={pullRequests.handleToggle}
        />
      ))}
    </DetailsSection>
  )
}
