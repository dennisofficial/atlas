import { useMemo } from 'react'

import type {
  StreamSessionRow,
  SessionStatusOutput,
  SessionViewOutput,
} from '@dltech/atlas-protocol'

import type { FooterItem } from '../ui/footer-item'
import type { FooterContext, FooterLayout } from '../ui/footer-layout'
import type { DraftControls } from '../ui/hooks/use-draft'
import { modelLabel } from '../ui/model-label'
import type { SidebarSection } from '../ui/sidebar-section'
import { effortOf, footerContextOf, footerLayoutOf } from './footer-model'
import { headerModelOf, type DiffStat } from './header-model'
import { podPillOf } from './pod-pill'
import {
  pinnedEntryOf,
  pullRequestEntriesOf,
  pullRequestItemOf,
  pullRequestSectionOf,
  type PullRequestEntry,
} from './pull-request'
import type { SessionApi } from './session-api'
import { contextReadingOf, repoOf } from './session-view'
import { bellFooterItemOf, bellItemOf, subscriptionsSectionOf } from './subscription-rows'
import { useChanges } from './use-changes'
import { useFooterStrip, type FooterStripControl } from './use-footer-strip'
import { useSubscriptions } from './use-subscriptions'

const NO_SUBSCRIPTIONS: SessionViewOutput['subscriptions'] = []

export type SessionChrome = {
  entries: readonly PullRequestEntry[]
  sections: readonly SidebarSection[]
  header: { repo: string; diff: DiffStat | null }
  footer: FooterLayout
  footerContext: FooterContext
  footerStrip: FooterStripControl
}

export function useSessionChrome(args: {
  api: SessionApi
  sessionId: string
  row: StreamSessionRow | undefined
  view: SessionViewOutput | undefined
  status: SessionStatusOutput | undefined
  working: boolean
  width: number
  now: () => number
  draft: DraftControls
  openUrl: (url: string) => void
  onProblem: (reason: string) => void
}): SessionChrome {
  const { api, sessionId, row, view, status, working, width, now, draft, openUrl, onProblem } = args
  const at = view?.at

  const subscriptions = useMemo(() => view?.subscriptions ?? NO_SUBSCRIPTIONS, [at, view])
  const entries = useMemo(
    () =>
      pullRequestEntriesOf({
        row,
        linked: view?.pullRequests ?? [],
        branch: view?.checkouts.primary?.branch ?? null,
      }),
    [at, row, view],
  )
  const context = useMemo(() => contextReadingOf(view), [at, view])
  const repo = useMemo(() => repoOf(view), [at, view])

  const changes = useChanges({ api, sessionId, working })
  const subscriptionControl = useSubscriptions({
    api,
    sessionId,
    subscriptions,
    entries,
    onProblem,
  })

  const sections = useMemo(() => {
    const github = pullRequestSectionOf({
      entries,
      branch: view?.checkouts.primary?.branch ?? null,
      now: now(),
      onOpen: openUrl,
      bellOf: (entry) =>
        bellItemOf({
          entry,
          subscriptions,
          onActivate: () => subscriptionControl.handleBell(entry),
        }),
    })
    const subs = subscriptionsSectionOf({
      subscriptions,
      entries,
      onRemove: subscriptionControl.handleRemove,
    })
    return [github, subs].filter((section): section is SidebarSection => section !== null)
  }, [
    entries,
    openUrl,
    subscriptionControl.handleBell,
    subscriptionControl.handleRemove,
    subscriptions,
    view,
  ])

  const header = useMemo(() => headerModelOf({ repo, changes, width }), [changes, repo, width])

  const pod = podPillOf({ pod: status?.pod, sandbox: status?.sandbox, now: now() })
  const pinned = pinnedEntryOf(entries)
  const prItem =
    pinned === undefined
      ? undefined
      : pullRequestItemOf({ entry: pinned, overflow: entries.length - 1, onOpen: openUrl })
  const bellItem =
    pinned === undefined
      ? undefined
      : bellFooterItemOf({
          entry: pinned,
          subscriptions,
          onActivate: () => subscriptionControl.handleBell(pinned),
        })

  const items: FooterItem[] = [pod, prItem, bellItem].filter(
    (item): item is FooterItem => item !== undefined && item !== null,
  )
  const footerContext = footerContextOf(context)
  const footer = footerLayoutOf({
    width,
    model: modelLabel(row?.model.ref ?? ''),
    effort: effortOf(row?.model.effort ?? 'medium'),
    fast: row?.model.fast ?? false,
    items,
    context: footerContext,
  })
  const footerStrip = useFooterStrip({ items: footer.instruments.items, draft })

  return { entries, sections, header, footer, footerContext, footerStrip }
}
