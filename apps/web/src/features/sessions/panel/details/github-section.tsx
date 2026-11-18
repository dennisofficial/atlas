'use client'

import { GitBranchIcon } from 'lucide-react'

import type { SessionViewOutput } from '@dltech/atlas-protocol'
import { Table, TableBody, TableCell, TableRow } from '@dltech/atlas-ui/components/table'

import {
  PullRequestChecks,
  PullRequestConflict,
  PullRequestIcon,
} from '@/features/shell/thread-pr-presentation'
import type { PullRequestEntry } from '@/features/threads/data/pull-request-entries'
import { DetailsSection } from '@/features/threads/panel/details/section'
import { BODY_CELL } from '@/features/threads/panel/details/table-parts'

import { useSessionPaneValue } from '../pane-value'

const COLUMNS = 4

type CheckoutRepo = SessionViewOutput['checkouts']['repos'][number]

function CheckoutGroup({ repo }: { repo: CheckoutRepo }) {
  const range = repo.base === null || repo.head === null ? null : `${repo.base} → ${repo.head}`
  return (
    <>
      <TableRow data-pane-checkout-repo>
        <TableCell colSpan={COLUMNS} className={`${BODY_CELL} pt-2`}>
          <span className="block truncate text-xs text-muted-foreground" title={repo.repo}>
            {repo.repo}
            {range === null ? null : <span className="font-mono"> · {range}</span>}
          </span>
        </TableCell>
      </TableRow>
      {repo.branches.map((branch) => (
        <TableRow key={branch.name} data-pane-checkout-branch>
          <TableCell className={`${BODY_CELL} w-6`}>
            <GitBranchIcon
              role="img"
              aria-label="Branch"
              className="size-3.5 text-muted-foreground"
            />
          </TableCell>
          <TableCell colSpan={COLUMNS - 1} className={`${BODY_CELL} max-w-0`}>
            <span
              className="block truncate font-mono text-sm"
              title={branch.worktreePath ?? branch.name}
            >
              {branch.name}
            </span>
          </TableCell>
        </TableRow>
      ))}
    </>
  )
}

function PullRequestRow({ entry }: { entry: PullRequestEntry }) {
  return (
    <TableRow data-pane-pull-request>
      <TableCell className={`${BODY_CELL} w-6`}>
        <PullRequestIcon entry={entry} />
      </TableCell>
      <TableCell className={`${BODY_CELL} whitespace-nowrap`}>
        <a
          href={entry.url}
          target="_blank"
          rel="noreferrer"
          className="font-mono underline-offset-2 hover:underline"
        >
          #{entry.number}
        </a>
      </TableCell>
      <TableCell className={`${BODY_CELL} max-w-0`}>
        <span className="block truncate text-sm" title={entry.title}>
          {entry.title ?? entry.repo}
        </span>
      </TableCell>
      <TableCell className={`${BODY_CELL} whitespace-nowrap`}>
        <span className="flex items-center gap-1.5">
          <span className="font-mono text-xs text-muted-foreground">{entry.branch}</span>
          <PullRequestConflict entry={entry} />
          <PullRequestChecks entry={entry} />
        </span>
      </TableCell>
    </TableRow>
  )
}

export function SessionGithubSection() {
  const { view, checkouts } = useSessionPaneValue()
  if (checkouts.repos.length === 0 && view.entries.length === 0) return null
  return (
    <DetailsSection title="GitHub">
      <Table>
        <TableBody>
          {checkouts.repos.map((repo) => (
            <CheckoutGroup key={repo.repo} repo={repo} />
          ))}
          {view.entries.map((entry) => (
            <PullRequestRow key={`${entry.repo}#${entry.number}`} entry={entry} />
          ))}
        </TableBody>
      </Table>
    </DetailsSection>
  )
}
