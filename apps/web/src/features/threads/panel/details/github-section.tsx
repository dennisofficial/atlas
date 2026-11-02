'use client'

import { GitBranchIcon } from 'lucide-react'

import { DetailRow } from '@dltech/atlas-ui/ai/detail-row'

import type { CheckoutView } from '../../data/session-checkouts'
import { useThreadPanel } from '../thread-panel-context'
import { PullRequestRowItem } from './pull-request-row'
import { DetailsSection } from './section'

function CheckoutBranch({ checkout }: { checkout: CheckoutView }) {
  return (
    <>
      {checkout.label === undefined ? null : (
        <p className="truncate px-1 pt-1 text-xs text-muted-foreground" title={checkout.label}>
          {checkout.label}
        </p>
      )}
      <DetailRow
        label={checkout.branch}
        detail={checkout.path}
        title={checkout.path}
        icon={<GitBranchIcon aria-hidden className="size-3.5" />}
        mono
      />
    </>
  )
}

export function GithubSection() {
  const { details } = useThreadPanel()
  const { pullRequests } = details
  const { checkouts, looseKeys, rows } = pullRequests
  if (checkouts.length === 0 && rows.length === 0) return null
  const renderRows = (keys: readonly string[]) =>
    rows
      .filter((row) => keys.includes(row.key))
      .map((row) => (
        <PullRequestRowItem
          key={row.key}
          row={row}
          bell={pullRequests.bells[row.key]}
          onToggleBell={pullRequests.handleToggle}
        />
      ))

  return (
    <DetailsSection title="GitHub" ref={pullRequests.observationRef}>
      {checkouts.map((checkout) => (
        <div key={checkout.key} className="flex flex-col gap-0.5">
          <CheckoutBranch checkout={checkout} />
          {renderRows(checkout.rowKeys)}
        </div>
      ))}
      {renderRows(looseKeys)}
    </DetailsSection>
  )
}
