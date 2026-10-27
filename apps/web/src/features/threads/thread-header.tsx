'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  ChevronRightIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  PanelRightIcon,
  PlusIcon,
} from 'lucide-react'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import { SidebarTrigger } from '@dltech/atlas-ui/components/sidebar'
import { Skeleton } from '@dltech/atlas-ui/components/skeleton'

import { EHeaderState, STATE_LABEL, type PullRequestBadge } from './data/header-model'

export type HeaderParent = {
  id: string
  title: string | null
}

export type ThreadHeaderProps = {
  title: string | null
  state: EHeaderState
  parent?: HeaderParent | undefined
  branch?: string | undefined
  pullRequest?: PullRequestBadge | undefined
  podChip?: ReactNode
  onOpenPanel: () => void
}

const BADGE_VARIANT: Record<EHeaderState, 'destructive' | 'default' | 'secondary'> = {
  [EHeaderState.Failed]: 'destructive',
  [EHeaderState.NeedsYou]: 'default',
  [EHeaderState.Running]: 'secondary',
  [EHeaderState.Idle]: 'secondary',
}

function ParentCrumb({ parent }: { parent: HeaderParent }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="hidden min-w-0 shrink items-center gap-1 text-sm md:flex"
    >
      {parent.title === null ? (
        <Skeleton className="h-4 w-24" />
      ) : (
        <Link
          href={`/threads/${parent.id}`}
          className="max-w-48 truncate rounded-sm text-muted-foreground outline-hidden hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {parent.title}
        </Link>
      )}
      <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
    </nav>
  )
}

function PullRequestLink({ pullRequest }: { pullRequest: PullRequestBadge }) {
  return (
    <Badge
      variant="outline"
      render={<a href={pullRequest.url} target="_blank" rel="noreferrer" />}
      className="hidden sm:inline-flex"
    >
      <GitPullRequestIcon />
      <span className="font-mono">{pullRequest.label}</span>
      {pullRequest.stateLabel}
    </Badge>
  )
}

export function ThreadHeader(props: ThreadHeaderProps) {
  const { title, state, parent, branch, pullRequest, podChip, onOpenPanel } = props
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-2 md:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger aria-label="Open navigation" />
        {parent ? <ParentCrumb parent={parent} /> : null}
        {title === null ? (
          <Skeleton className="h-4 w-48" />
        ) : (
          <h1 className="truncate text-sm font-medium">{title}</h1>
        )}
        {branch ? (
          <span className="hidden min-w-0 items-center gap-1 font-mono text-xs text-muted-foreground sm:flex">
            <GitBranchIcon className="size-3.5 shrink-0" />
            <span className="truncate">{branch}</span>
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {pullRequest ? <PullRequestLink pullRequest={pullRequest} /> : null}
        <Badge variant={BADGE_VARIANT[state]}>{STATE_LABEL[state]}</Badge>
        {podChip}
        <Button
          variant="ghost"
          size="icon-lg"
          aria-label="Open panel"
          className="md:hidden"
          onClick={onOpenPanel}
        >
          <PanelRightIcon />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label="New thread"
          nativeButton={false}
          render={<Link href="/threads/new" />}
        >
          <PlusIcon />
          <span className="hidden sm:inline">New thread</span>
        </Button>
      </div>
    </header>
  )
}
