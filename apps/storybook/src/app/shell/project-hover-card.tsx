import { BadgeCheck, CircleCheck, CircleX, MessagesSquare, Pin, Settings } from 'lucide-react'
import type { ReactNode } from 'react'

import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from '@dltech/atlas-ui/components/avatar'
import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@dltech/atlas-ui/components/hover-card'

import { type AppProject, ECiStatus, type ProjectCommit, RECENT_COMMITS } from '../../fixtures/app'

const VISIBLE_AVATARS = 2

export interface ProjectHoverCardProps {
  project: AppProject
  defaultOpen?: boolean
  className?: string
  children: ReactNode
}

function CommitAuthors({ authors }: { authors: string[] }) {
  const overflow = authors.length - VISIBLE_AVATARS
  return (
    <AvatarGroup className="w-16 shrink-0 -space-x-1.5">
      {authors.slice(0, VISIBLE_AVATARS).map((initials) => (
        <Avatar key={initials} size="sm">
          <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
        </Avatar>
      ))}
      {overflow > 0 && <AvatarGroupCount className="text-[10px]">+{overflow}</AvatarGroupCount>}
    </AvatarGroup>
  )
}

function CiIcon({ ci }: { ci: ECiStatus }) {
  if (ci === ECiStatus.Passing) {
    return (
      <CircleCheck
        role="img"
        aria-label="Checks passing"
        className="size-4 shrink-0 text-success"
      />
    )
  }
  return (
    <CircleX role="img" aria-label="Checks failing" className="size-4 shrink-0 text-destructive" />
  )
}

function CommitRow({ commit }: { commit: ProjectCommit }) {
  return (
    <li className="flex items-center gap-2 py-1">
      <CommitAuthors authors={commit.authors} />
      <span className="min-w-0 flex-1 truncate text-xs">{commit.subject}</span>
      {commit.verified && (
        <Badge variant="outline" className="text-success">
          <BadgeCheck />
          Verified
        </Badge>
      )}
      <CiIcon ci={commit.ci} />
      <span className="w-6 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums">
        {commit.age}
      </span>
    </li>
  )
}

export function ProjectHoverCardBody({ project }: { project: AppProject }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-medium">
          <span className="text-muted-foreground">{project.owner}/</span>
          {project.name}
        </p>
        <div className="flex shrink-0 items-center">
          <Button variant="ghost" size="icon-xs" aria-label="Pin project">
            <Pin />
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="Project threads">
            <MessagesSquare />
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="Project settings">
            <Settings />
          </Button>
        </div>
      </div>
      <div className="flex flex-col">
        <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          Recent commits
        </p>
        <ul className="flex flex-col divide-y divide-border">
          {RECENT_COMMITS.map((commit) => (
            <CommitRow key={commit.sha} commit={commit} />
          ))}
        </ul>
      </div>
      <Button variant="link" size="xs" className="h-auto self-start p-0">
        View all commits →
      </Button>
    </div>
  )
}

export function ProjectHoverCard({
  project,
  defaultOpen,
  className,
  children,
}: ProjectHoverCardProps) {
  return (
    <HoverCard defaultOpen={defaultOpen}>
      <HoverCardTrigger delay={350} closeDelay={100} render={<div className={className} />}>
        {children}
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="start"
        sideOffset={8}
        alignOffset={-6}
        className="w-128 p-3"
      >
        <ProjectHoverCardBody project={project} />
      </HoverCardContent>
    </HoverCard>
  )
}
