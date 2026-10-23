import {
  ArrowUpRightIcon,
  EllipsisIcon,
  GitBranchIcon,
  GlobeIcon,
  LockIcon,
  RefreshCwIcon,
} from 'lucide-react'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@dltech/atlas-ui/components/dropdown-menu'

import type { GithubRepo } from '../../fixtures/project-settings'
import { SettingsCard } from '../settings/settings-layout'
import { repoSlug } from './overview-model'
import { RepoAvatar } from './overview-repo-avatar'

function VisibilityBadge({ isPrivate }: { isPrivate: boolean }) {
  if (isPrivate) {
    return (
      <Badge variant="secondary">
        <LockIcon data-icon="inline-start" />
        Private
      </Badge>
    )
  }
  return (
    <Badge variant="outline">
      <GlobeIcon data-icon="inline-start" />
      Public
    </Badge>
  )
}

export function RepositoryCard({ repo }: { repo: GithubRepo }) {
  const slug = repoSlug(repo)
  return (
    <SettingsCard>
      <div className="flex items-start gap-4 p-4">
        <RepoAvatar owner={repo.owner} avatarUrl={repo.avatarUrl} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <a
              href={`https://github.com/${slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-w-0 items-center gap-1 font-mono text-sm font-medium underline-offset-4 hover:underline"
            >
              <span className="truncate">{slug}</span>
              <ArrowUpRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
            </a>
            <VisibilityBadge isPrivate={repo.isPrivate} />
          </div>
          {repo.description ? (
            <p className="max-w-prose text-sm text-muted-foreground">{repo.description}</p>
          ) : null}
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <GitBranchIcon className="size-3.5" />
            Default branch
            <code className="font-mono text-xs text-foreground">{repo.defaultBranch}</code>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" aria-label="Repository actions" />}
            >
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem>
                <RefreshCwIcon />
                Refresh from GitHub
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </SettingsCard>
  )
}
