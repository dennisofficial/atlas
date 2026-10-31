'use client'

import Link from 'next/link'
import { ChevronRightIcon, LaptopIcon, PanelRightIcon } from 'lucide-react'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import { SidebarTrigger } from '@dltech/atlas-ui/components/sidebar'
import { NamingTitle } from '@dltech/atlas-ui/ai/naming-title'
import { Skeleton } from '@dltech/atlas-ui/components/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dltech/atlas-ui/components/tooltip'

import { EHeaderState, STATE_LABEL } from './data/header-model'

export type HeaderParent = {
  id: string
  title: string | null
}

export type ThreadHeaderProps = {
  title: string | null
  naming?: boolean | undefined
  state: EHeaderState
  activityReason?: string | undefined
  parent?: HeaderParent | undefined
  local?: boolean | undefined
  onOpenPanel: () => void
}

const BADGE_VARIANT: Record<EHeaderState, 'destructive' | 'default' | 'secondary'> = {
  [EHeaderState.Failed]: 'destructive',
  [EHeaderState.NeedsYou]: 'default',
  [EHeaderState.Running]: 'secondary',
  [EHeaderState.Idle]: 'secondary',
  [EHeaderState.Unavailable]: 'secondary',
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

export function LocalPodIcon() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label="This Mac"
            className="flex shrink-0 items-center text-muted-foreground"
          />
        }
      >
        <LaptopIcon className="size-4" />
      </TooltipTrigger>
      <TooltipContent side="bottom">This Mac</TooltipContent>
    </Tooltip>
  )
}

export function ThreadHeader(props: ThreadHeaderProps) {
  const { title, naming = false, state, parent, local = false, onOpenPanel } = props
  const description =
    state === EHeaderState.Unavailable && props.activityReason !== undefined
      ? `${STATE_LABEL[state]}: ${props.activityReason}`
      : undefined
  return (
    <header
      data-chrome="titlebar"
      className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-2 md:px-4"
    >
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger aria-label="Open navigation" />
        {parent ? <ParentCrumb parent={parent} /> : null}
        {title === null && !naming ? (
          <Skeleton className="h-4 w-48" />
        ) : (
          <h1 className="min-w-0 text-sm font-medium">
            <NamingTitle title={title} naming={naming} />
          </h1>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {local ? <LocalPodIcon /> : null}
        <Badge variant={BADGE_VARIANT[state]} title={description} aria-label={description}>
          {STATE_LABEL[state]}
        </Badge>
        <Button
          variant="ghost"
          size="icon-lg"
          aria-label="Open panel"
          className="md:hidden"
          onClick={onOpenPanel}
        >
          <PanelRightIcon />
        </Button>
      </div>
    </header>
  )
}
