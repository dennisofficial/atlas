import { ChevronRightIcon } from 'lucide-react'
import Link from 'next/link'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { SidebarTrigger } from '@dltech/atlas-ui/components/sidebar'

import { ESessionState } from './session-types'

export interface HeaderParent {
  title: string
  href: string
}

export interface SessionHeaderProps {
  parent?: HeaderParent
  state?: ESessionState
  title?: string
  detail?: string
  badgeLabel?: string | null
}

export const DEFAULT_TITLE = 'Rebase ui on shadcn base-nova'

const STATE_LABEL: Record<ESessionState, string> = {
  [ESessionState.Running]: 'Running',
  [ESessionState.Idle]: 'Idle',
  [ESessionState.ApprovalPending]: 'Needs approval',
}

export function SessionHeader({
  state = ESessionState.Running,
  title = DEFAULT_TITLE,
  detail,
  badgeLabel,
  parent,
}: SessionHeaderProps) {
  const badge = badgeLabel === undefined ? STATE_LABEL[state] : badgeLabel

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3">
      <SidebarTrigger />
      {parent ? (
        <nav aria-label="Breadcrumb" className="flex min-w-0 shrink items-center gap-1 text-sm">
          <Link
            href={parent.href}
            className="max-w-48 truncate rounded-sm text-muted-foreground outline-hidden hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {parent.title}
          </Link>
          <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        </nav>
      ) : null}
      <h1 className="truncate text-sm font-medium">{title}</h1>
      {detail ? <span className="shrink-0 text-xs text-muted-foreground">{detail}</span> : null}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {badge ? <Badge variant="secondary">{badge}</Badge> : null}
      </div>
    </header>
  )
}
