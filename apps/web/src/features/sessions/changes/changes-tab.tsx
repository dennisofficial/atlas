'use client'

import { ChangesPanel, type ChangesLayout } from '@dltech/atlas-ui/ai/changes-panel'
import { GitCompareIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { isSessionWorking } from '@/features/sessions/data/session-state'
import { useSessionPaneValue } from '@/features/sessions/panel/pane-value'
import { TabPlaceholder } from '@/features/threads/panel/tab-placeholder'

import { useCheckoutChoice } from '../checkouts/checkout-choice-context'
import { CheckoutSelect } from '../checkouts/checkout-select'
import { recallChanges, rememberChanges, scopedPathsOf, withScopedPaths } from './changes-memory'
import { DiffBody } from './diff-body'
import { changedFilesOf } from './rows'
import { snapshotLabel } from './snapshot-age'
import type { CheckoutChanges } from './use-changes'
import { useOpenRequest } from './use-open-request'

export const CHANGES_SCOPE = 'branch'

const SCOPES = [{ id: CHANGES_SCOPE, label: 'All changes', detail: 'since the branch point' }]

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
      <ChangesPanel
        files={files}
        scopes={SCOPES}
        scope={CHANGES_SCOPE}
        layout={args.layout}
        onLayoutChange={args.onLayoutChange}
        expanded={paths}
        onExpandedChange={handleExpandedChange}
        hideActions
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
  const { sessionId, status, openRequest, requestOpen, consumeOpenRequest } = useSessionPaneValue()
  const { changes, options, selectedId, select } = useCheckoutChoice()
  const [layout, setLayout] = useState<ChangesLayout>('flat')
  const [expanded, setExpanded] = useState<string[]>(() => recallChanges(sessionId))
  const scroller = useOpenRequest({
    sessionId,
    changes,
    options,
    selectedId,
    select,
    expanded,
    setExpanded,
    openRequest,
    requestOpen,
    consumeOpenRequest,
  })
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
  const shown =
    changes.checkouts.find((checkout) => checkout.checkoutId === selectedId) ?? changes.checkouts[0]
  const empty = shown === undefined || shown.files.length === 0
  if (empty && options.length < 2) {
    return (
      <div data-changes-tab="empty">
        <Notice
          title="No changes yet"
          description="The pod has snapshotted this session's checkout and it does not differ from the branch point."
        />
      </div>
    )
  }
  const live = status !== undefined && isSessionWorking(status)
  return (
    <div data-changes-tab={empty ? 'empty' : 'ready'} className="flex h-full min-h-0 flex-col">
      <div
        data-changes-snapshot
        className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground"
      >
        <span className="min-w-0 truncate">
          {shown === undefined
            ? null
            : snapshotLabel({ updatedAt: shown.updatedAt, live, now: Date.now() })}
        </span>
        <CheckoutSelect />
      </div>
      {shown === undefined || shown.files.length === 0 ? (
        <Notice
          title="No changes yet"
          description="The pod has snapshotted this session's checkout and it does not differ from the branch point."
        />
      ) : (
        <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
          <CheckoutSection
            sessionId={sessionId}
            checkout={shown}
            layout={layout}
            onLayoutChange={setLayout}
            expanded={expanded}
            onExpandedChange={setExpanded}
          />
        </div>
      )}
    </div>
  )
}
