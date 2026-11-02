import { BellIcon, BellOffIcon, CircleCheckIcon, CircleXIcon, GitBranchIcon } from 'lucide-react'
import { useState } from 'react'

import { Table, TableBody, TableCell, TableRow } from '@dltech/atlas-ui/components/table'

import { PrStateIcon } from '../pr-parts'
import { EPrState } from '../pull-request-model'
import { DENSE_BRANCH, DENSE_PRS, type DensePullRequest } from './dense-fixtures'
import { DetailsSection } from './section'
import { BODY_CELL, IconAction, MID_COLUMN } from './table-parts'

function Checks({ pr }: { pr: DensePullRequest }) {
  return (
    <span className="flex items-center justify-end gap-2 text-xs tabular-nums">
      <span className="flex items-center gap-1 text-muted-foreground">
        <CircleCheckIcon aria-hidden className="size-3.5 text-success" />
        {pr.passing}
        <span className="sr-only">passing</span>
      </span>
      {pr.failing > 0 ? (
        <span className="flex items-center gap-1 text-destructive">
          <CircleXIcon aria-hidden className="size-3.5" />
          {pr.failing}
          <span className="sr-only">failing</span>
        </span>
      ) : null}
    </span>
  )
}

function PullRequestRow(props: { pr: DensePullRequest; onToggleWatch: () => void }) {
  const { pr } = props
  const label = `${pr.watched ? 'Stop watching' : 'Watch'} #${pr.number}`
  return (
    <TableRow>
      <TableCell className={`${BODY_CELL} w-6`}>
        <span className="flex size-4 items-center justify-center">
          <PrStateIcon state={pr.merged ? EPrState.Merged : EPrState.Open} />
        </span>
      </TableCell>
      <TableCell className={`${BODY_CELL} w-full max-w-0`}>
        <a
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          className="flex min-w-0 items-baseline gap-1.5 rounded-sm text-sm outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span className="shrink-0 font-medium tabular-nums">#{pr.number}</span>
          <span className="truncate">{pr.title}</span>
        </a>
        <span className="block truncate font-mono text-xs text-muted-foreground">{pr.branch}</span>
      </TableCell>
      <TableCell className={`${BODY_CELL} ${MID_COLUMN} text-right`}>
        <Checks pr={pr} />
      </TableCell>
      <TableCell className={`${BODY_CELL} text-right`}>
        <IconAction
          label={label}
          pressed={pr.watched}
          icon={pr.watched ? <BellIcon aria-hidden /> : <BellOffIcon aria-hidden />}
          onClick={props.onToggleWatch}
        />
      </TableCell>
    </TableRow>
  )
}

export function GithubTable() {
  const [prs, setPrs] = useState(DENSE_PRS)
  const handleToggleWatch = (number: number) =>
    setPrs((held) =>
      held.map((pr) => (pr.number === number ? { ...pr, watched: !pr.watched } : pr)),
    )

  return (
    <DetailsSection title="GitHub" count={prs.length}>
      <Table>
        <TableBody>
          <TableRow>
            <TableCell className={`${BODY_CELL} w-6`}>
              <span className="flex size-4 items-center justify-center text-muted-foreground">
                <GitBranchIcon role="img" aria-label="Branch" className="size-3.5" />
              </span>
            </TableCell>
            <TableCell colSpan={3} className={`${BODY_CELL} max-w-0`}>
              <span className="block truncate font-mono text-sm">{DENSE_BRANCH}</span>
            </TableCell>
          </TableRow>
          {prs.map((pr) => (
            <PullRequestRow
              key={pr.number}
              pr={pr}
              onToggleWatch={() => handleToggleWatch(pr.number)}
            />
          ))}
        </TableBody>
      </Table>
    </DetailsSection>
  )
}
