'use client'

import { GitBranchIcon } from 'lucide-react'

import { DetailRow } from '@dltech/atlas-ui/ai/detail-row'

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
        <DetailRow label={branch} icon={<GitBranchIcon aria-hidden className="size-3.5" />} mono />
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
