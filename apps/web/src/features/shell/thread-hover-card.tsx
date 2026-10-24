import { Folder } from 'lucide-react'
import type { ReactNode } from 'react'

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@dltech/atlas-ui/components/hover-card'
import { Separator } from '@dltech/atlas-ui/components/separator'
import type { WireThread } from '@dltech/atlas-wire/web'

import { relativeTime } from '@/features/settings/data/personal/relative-time'
import { UNTITLED } from '@/features/threads/data/untitled'

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5 text-foreground">{children}</span>
    </div>
  )
}

function ThreadHoverCardBody({ thread, projectName }: { thread: WireThread; projectName: string }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm leading-snug font-medium text-pretty">{thread.title ?? UNTITLED}</p>
        <p className="text-xs text-muted-foreground">
          Created {relativeTime({ from: thread.createdAt })}, updated{' '}
          {relativeTime({ from: thread.updatedAt })}
        </p>
      </div>
      <Separator />
      <div className="flex flex-col gap-1.5">
        {thread.model === undefined ? null : (
          <DetailRow label="Model">
            <span className="truncate">{thread.model.ref}</span>
          </DetailRow>
        )}
        <DetailRow label="Project">
          <Folder className="size-3.5 text-muted-foreground" />
          <span className="truncate">{projectName}</span>
        </DetailRow>
      </div>
    </div>
  )
}

export function ThreadHoverCard({
  thread,
  projectName,
  className,
  children,
}: {
  thread: WireThread
  projectName: string
  className?: string
  children: ReactNode
}) {
  return (
    <HoverCard>
      <HoverCardTrigger delay={350} closeDelay={100} render={<div className={className} />}>
        {children}
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="start"
        sideOffset={8}
        alignOffset={-6}
        className="w-72 p-3"
      >
        <ThreadHoverCardBody thread={thread} projectName={projectName} />
      </HoverCardContent>
    </HoverCard>
  )
}
