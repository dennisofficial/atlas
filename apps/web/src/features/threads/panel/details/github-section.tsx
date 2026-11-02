'use client'

import { GitBranchIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Table, TableBody, TableCell, TableRow } from '@dltech/atlas-ui/components/table'

import type { CheckoutView } from '../../data/session-checkouts'
import { useThreadPanel } from '../thread-panel-context'
import { PullRequestRowItem } from './pull-request-row'
import { DetailsSection } from './section'
import { BODY_CELL } from './table-parts'

const COLUMNS = 4

function CheckoutHead({ checkout }: { checkout: CheckoutView }) {
  return (
    <>
      {checkout.label === undefined ? null : (
        <TableRow>
          <TableCell colSpan={COLUMNS} className={`${BODY_CELL} pt-2`}>
            <span className="block truncate text-xs text-muted-foreground" title={checkout.label}>
              {checkout.label}
            </span>
          </TableCell>
        </TableRow>
      )}
      {checkout.rowKeys.length > 0 ? null : (
        <TableRow>
          <TableCell className={`${BODY_CELL} w-6`}>
            <span className="flex size-4 items-center justify-center text-muted-foreground">
              <GitBranchIcon role="img" aria-label="Branch" className="size-3.5" />
            </span>
          </TableCell>
          <TableCell colSpan={COLUMNS - 1} className={`${BODY_CELL} max-w-0`}>
            <span className="block truncate font-mono text-sm">{checkout.branch}</span>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

export function GithubSection() {
  const { details } = useThreadPanel()
  const { pullRequests } = details
  const { checkouts, looseKeys, rows } = pullRequests
  if (checkouts.length === 0 && rows.length === 0) return null
  const renderRows = (args: { keys: readonly string[]; branch?: string }) =>
    rows
      .filter((row) => args.keys.includes(row.key))
      .map((row) => (
        <PullRequestRowItem
          key={row.key}
          row={row}
          checkoutBranch={args.branch}
          bell={pullRequests.bells[row.key]}
          onToggleBell={pullRequests.handleToggle}
        />
      ))

  return (
    <DetailsSection title="GitHub" ref={pullRequests.observationRef}>
      <Table>
        <TableBody>
          {checkouts.map((checkout) => (
            <CheckoutGroup key={checkout.key} checkout={checkout}>
              {renderRows({ keys: checkout.rowKeys, branch: checkout.branch })}
            </CheckoutGroup>
          ))}
          {renderRows({ keys: looseKeys })}
        </TableBody>
      </Table>
    </DetailsSection>
  )
}

function CheckoutGroup(props: { checkout: CheckoutView; children: ReactNode }) {
  return (
    <>
      <CheckoutHead checkout={props.checkout} />
      {props.children}
    </>
  )
}
