'use client'

import { useState } from 'react'

import { Table, TableBody } from '@dltech/atlas-ui/components/table'

import { pullRequestRowOf } from '@/features/threads/data/pull-request-rows'
import { PullRequestRowItem } from '@/features/threads/panel/details/pull-request-row'
import { ToggleRow } from '@/features/threads/panel/details/table-parts'

import { useSessionPaneValue } from '../pane-value'
import { PullRequestBell } from './pull-request-bell'
import { SectionHead } from './rows'

const VISIBLE_ROWS = 3
const COLUMNS = 4

export function SessionGithubSection() {
  const { view } = useSessionPaneValue()
  const [expanded, setExpanded] = useState(false)
  if (view.entries.length === 0) return null
  const visible = expanded ? view.entries : view.entries.slice(0, VISIBLE_ROWS)
  const handleToggle = () => setExpanded((held) => !held)

  return (
    <section data-session-pull-requests aria-label="Pull requests" className="flex flex-col">
      <SectionHead title="Pull requests" count={view.entries.length} />
      <Table>
        <TableBody>
          {visible.map((entry) => {
            const row = pullRequestRowOf(entry)
            return (
              <PullRequestRowItem
                key={row.key}
                row={row}
                checkoutBranch={view.branch}
                bell={<PullRequestBell entry={entry} />}
              />
            )
          })}
          {view.entries.length > VISIBLE_ROWS ? (
            <ToggleRow
              colSpan={COLUMNS}
              label={expanded ? 'Show fewer' : `Show all (${view.entries.length})`}
              onToggle={handleToggle}
            />
          ) : null}
        </TableBody>
      </Table>
    </section>
  )
}
