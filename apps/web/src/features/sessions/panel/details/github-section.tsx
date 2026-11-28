'use client'

import { useState } from 'react'

import { pullRequestRowOf } from '@/features/threads/data/pull-request-rows'
import {
  EPullRequestRowLayout,
  PullRequestRowItem,
} from '@/features/threads/panel/details/pull-request-row'

import { useSessionPaneValue } from '../pane-value'
import { PullRequestBell } from './pull-request-bell'
import { subscriptionOf } from './pull-request-bell-model'
import { RowsToggle, SectionHead } from './rows'
import { RetainedRows, Reveal } from './reveal'

const VISIBLE_ROWS = 3

export function SessionGithubSection() {
  const { view } = useSessionPaneValue()
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? view.entries : view.entries.slice(0, VISIBLE_ROWS)
  const handleToggle = () => setExpanded((held) => !held)

  return (
    <Reveal open={view.entries.length > 0} section>
      <section data-session-pull-requests aria-label="Pull requests" className="flex flex-col">
        <SectionHead title="Pull requests" count={view.entries.length} />
        <div className="flex flex-col gap-0.5">
          <RetainedRows
            rows={visible}
            rowKey={(entry) => `${entry.repo}#${entry.number}`}
            render={({ row: entry, open, onExited }) => {
              const row = pullRequestRowOf(entry)
              return (
                <Reveal open={open} onExited={onExited}>
                  <PullRequestRowItem
                    key={row.key}
                    row={row}
                    layout={EPullRequestRowLayout.Row}
                    checkoutBranch={view.branch}
                    watching={subscriptionOf({ entry, rows: view.subscriptionRows }) !== undefined}
                    bell={<PullRequestBell entry={entry} />}
                  />
                </Reveal>
              )
            }}
          />
        </div>
        {view.entries.length > VISIBLE_ROWS ? (
          <RowsToggle expanded={expanded} onToggle={handleToggle}>
            {expanded ? 'Show fewer' : `Show all (${view.entries.length})`}
          </RowsToggle>
        ) : null}
      </section>
    </Reveal>
  )
}
