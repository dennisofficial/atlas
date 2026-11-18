'use client'

import { ChangesPanel, type ChangesLayout } from '@dltech/atlas-ui/ai/changes-panel'
import type { SessionStatusOutput } from '@dltech/atlas-protocol'
import { GitCompareIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { isSessionWorking } from '@/features/sessions/data/session-state'
import { useSessionPaneValue } from '@/features/sessions/panel/pane-value'
import { TabPlaceholder } from '@/features/threads/panel/tab-placeholder'

import { recallChanges, rememberChanges, scopedPathsOf, withScopedPaths } from './changes-memory'
import { DiffBody } from './diff-body'
import { changedFilesOf } from './rows'
import { snapshotLabel } from './snapshot-age'
import { type CheckoutChanges, useChanges } from './use-changes'

export const CHANGES_SCOPE = 'branch'

const SCOPES = [{ id: CHANGES_SCOPE, label: 'All changes', detail: 'since the branch point' }]

export const changesSignalOf = (status: SessionStatusOutput | undefined): string =>
  status === undefined ? 'no-status' : `${status.state}:${status.since ?? ''}`

function Notice(args: { title: string; description: string }) {
  return (
    <TabPlaceholder
      icon={<GitCompareIcon aria-hidden />}
      title={args.title}
      description={args.description}
    />
  )
}

function CheckoutSection(args: {
  sessionId: string
  checkout: CheckoutChanges
  titled: boolean
  layout: ChangesLayout
  onLayoutChange: (layout: ChangesLayout) => void
  expanded: string[]
  onExpandedChange: (paths: string[]) => void
}) {
  const { checkout } = args
  const paths = scopedPathsOf({ checkoutId: checkout.checkoutId, expanded: args.expanded })
  const files = changedFilesOf({ files: checkout.files, diffs: new Map() })
  const handleExpandedChange = (next: string[]) =>
    args.onExpandedChange(
      withScopedPaths({ checkoutId: checkout.checkoutId, expanded: args.expanded, paths: next }),
    )
  return (
    <section data-changes-checkout={checkout.checkoutId} className="flex min-h-0 flex-col">
      {args.titled ? (
        <div className="flex shrink-0 items-baseline justify-between gap-2 border-b border-border px-3 py-2">
          <span className="min-w-0 truncate text-sm text-foreground">{checkout.repo}</span>
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {checkout.worktreePath}
          </span>
        </div>
      ) : null}
      <ChangesPanel
        files={files}
        scopes={SCOPES}
        scope={CHANGES_SCOPE}
        layout={args.layout}
        onLayoutChange={args.onLayoutChange}
        expanded={paths}
        onExpandedChange={handleExpandedChange}
        renderDiff={(file) => {
          const entry = checkout.files.find((candidate) => candidate.path === file.path)
          if (entry === undefined) return null
          return (
            <DiffBody sessionId={args.sessionId} checkoutId={checkout.checkoutId} file={entry} />
          )
        }}
      />
    </section>
  )
}

export function ChangesTab() {
  const { sessionId, status } = useSessionPaneValue()
  const changes = useChanges({ sessionId, signal: changesSignalOf(status) })
  const [layout, setLayout] = useState<ChangesLayout>('flat')
  const [expanded, setExpanded] = useState<string[]>(() => recallChanges(sessionId))
  useEffect(() => {
    rememberChanges({ sessionId, expanded })
  }, [sessionId, expanded])

  if (changes.status === 'failed' && changes.unavailable) {
    return (
      <div data-changes-tab="unavailable">
        <Notice
          title="Change storage unavailable"
          description="The control plane has no bucket for changed file contents, so no diff can be read."
        />
      </div>
    )
  }
  if (changes.status === 'failed') {
    return (
      <div data-changes-tab="failed">
        <Notice title="Changes unavailable" description={changes.message} />
      </div>
    )
  }
  if (changes.status === 'loading') {
    return (
      <div data-changes-tab="loading" className="flex h-full p-4">
        <p role="status" className="text-sm text-muted-foreground">
          Loading changes…
        </p>
      </div>
    )
  }
  const recorded = changes.checkouts.filter((checkout) => checkout.files.length > 0)
  if (recorded.length === 0) {
    return (
      <div data-changes-tab="empty">
        <Notice
          title="No changes yet"
          description="The pod has snapshotted this session's checkouts and none of them differ from the branch point."
        />
      </div>
    )
  }
  const live = status !== undefined && isSessionWorking(status)
  const latest = recorded.reduce((newest, checkout) => Math.max(checkout.updatedAt, newest), 0)
  return (
    <div data-changes-tab="ready" className="flex h-full min-h-0 flex-col">
      <p
        data-changes-snapshot
        className="shrink-0 border-b border-border px-3 py-1.5 text-xs text-muted-foreground"
      >
        {snapshotLabel({ updatedAt: latest, live, now: Date.now() })}
      </p>
      <div className="min-h-0 flex-1 overflow-auto">
        {recorded.map((checkout) => (
          <CheckoutSection
            key={checkout.checkoutId}
            sessionId={sessionId}
            checkout={checkout}
            titled={recorded.length > 1}
            layout={layout}
            onLayoutChange={setLayout}
            expanded={expanded}
            onExpandedChange={setExpanded}
          />
        ))}
      </div>
    </div>
  )
}
