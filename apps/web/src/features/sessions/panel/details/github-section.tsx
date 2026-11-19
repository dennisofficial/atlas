'use client'

import type { ReactNode } from 'react'

import { cn } from '@dltech/atlas-ui/lib/utils'

import { PullRequestIcon } from '@/features/shell/thread-pr-presentation'
import type { PullRequestEntry } from '@/features/threads/data/pull-request-entries'

import { useSessionPaneValue } from '../pane-value'
import { FoldedRows, Pill, Row, SectionHead } from './rows'

const PR_STATE: Record<string, { label: string; tone: string }> = {
  open: { label: 'Open', tone: 'bg-pr-open/10 text-pr-open' },
  draft: { label: 'Draft', tone: 'bg-pr-draft/10 text-pr-draft' },
  merged: { label: 'Merged', tone: 'bg-pr-merged/12 text-pr-merged' },
  closed: { label: 'Closed', tone: 'bg-pr-closed/10 text-pr-closed' },
}

const ciLabelOf = (entry: PullRequestEntry): string | null => {
  if (entry.checksPassed === undefined) return null
  const failed = entry.checksFailed ?? 0
  const running = entry.checksRunning ?? 0
  return `CI ${entry.checksPassed}/${entry.checksPassed + failed + running}`
}

const metaOf = (entry: PullRequestEntry): ReactNode => {
  const ci = ciLabelOf(entry)
  return (
    <>
      <span className="font-mono">#{entry.number}</span>
      {ci === null ? null : (
        <>
          {' · '}
          <span className={cn('font-mono', (entry.checksFailed ?? 0) > 0 && 'text-destructive')}>
            {ci}
          </span>
        </>
      )}
      {entry.mergeable === false ? ' · conflicts' : null}
    </>
  )
}

function PullRequestRow({ entry }: { entry: PullRequestEntry }) {
  const state = PR_STATE[(entry.state ?? '').toLowerCase()]
  return (
    <Row
      leading={<PullRequestIcon entry={entry} />}
      title={
        <a
          href={entry.url}
          target="_blank"
          rel="noreferrer"
          title={entry.title ?? entry.repo}
          className="outline-none hover:underline focus-visible:underline"
        >
          {entry.title ?? entry.repo}
        </a>
      }
      meta={metaOf(entry)}
      trailing={state === undefined ? null : <Pill label={state.label} tone={state.tone} />}
    />
  )
}

export function SessionGithubSection() {
  const { view } = useSessionPaneValue()
  if (view.entries.length === 0) return null
  return (
    <section data-session-pull-requests aria-label="Pull requests" className="flex flex-col">
      <SectionHead title="Pull requests" count={view.entries.length} />
      <FoldedRows
        rows={view.entries}
        render={(entry) => <PullRequestRow key={`${entry.repo}#${entry.number}`} entry={entry} />}
      />
    </section>
  )
}
