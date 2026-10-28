import { FolderGit2Icon, LockIcon, RefreshCwIcon } from 'lucide-react'

import type { GithubRepoSummary } from '@dltech/atlas-wire/web'
import { Button } from '@dltech/atlas-ui/components/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@dltech/atlas-ui/components/combobox'
import { Field, FieldError, FieldLabel } from '@dltech/atlas-ui/components/field'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { relativeTime } from '@/features/settings/data/personal/relative-time'
import { QueryGate } from '@/features/settings/data/shared/query-gate'

import { BranchField } from './new-project-branch-field'
import { ConnectGithub } from './new-project-connect'
import { findGithubRepo, repoChoices, repoInputError } from './new-project-repos'
import type { DraftPatch, ProjectDraft } from './new-project-types'
import { useGithubRepos } from './use-github-repos'

const RECENT_REPO_COUNT = 4

interface PickerProps {
  repos: readonly GithubRepoSummary[]
  draft: ProjectDraft
  patch: DraftPatch
}

function RecentTiles({ repos, draft, patch }: PickerProps) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">Recent repositories</p>
      <ul className="grid grid-cols-2 gap-2">
        {repos.slice(0, RECENT_REPO_COUNT).map((repo) => {
          const selected = draft.repo === repo.fullName
          const handleClick = () =>
            patch({ repo: repo.fullName, repoQuery: repo.fullName, branch: null })
          return (
            <li key={repo.fullName}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={handleClick}
                className={cn(
                  'flex w-full flex-col gap-1 rounded-lg border border-border px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
                  selected && 'border-primary/40 bg-primary/5 hover:bg-primary/10',
                )}
              >
                <span className="flex items-center gap-1.5 text-sm">
                  <FolderGit2Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono text-xs font-medium">{repo.fullName}</span>
                </span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {repo.isPrivate ? <LockIcon aria-label="Private" className="size-3" /> : null}
                  {repo.pushedAt
                    ? `Updated ${relativeTime({ from: repo.pushedAt })}`
                    : 'Not pushed yet'}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function RepoPicker({ repos, draft, patch, onRefresh }: PickerProps & { onRefresh: () => void }) {
  const choices = repoChoices({ repos, query: draft.repoQuery })
  const error = repoInputError({ query: draft.repoQuery, choices })
  const handleValueChange = (next: string | null) =>
    patch({ repo: next, repoQuery: next ?? '', branch: null })
  const handleInputChange = (next: string, details: { reason: string }) => {
    if (details.reason !== 'input-change') return
    patch({ repoQuery: next, repo: null, branch: null })
  }

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor="repo-search">Find a repository</FieldLabel>
      <Combobox
        items={choices}
        filter={null}
        autoHighlight
        value={draft.repo}
        onValueChange={handleValueChange}
        inputValue={draft.repoQuery}
        onInputValueChange={handleInputChange}
      >
        <ComboboxInput
          id="repo-search"
          placeholder="Search, or paste a GitHub URL or owner/name"
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          spellCheck={false}
        />
        <ComboboxContent>
          <ComboboxEmpty>{error ?? 'No repositories match.'}</ComboboxEmpty>
          <ComboboxList>
            {(name: string) => (
              <ComboboxItem key={name} value={name} className="font-mono text-xs">
                <FolderGit2Icon className="text-muted-foreground" />
                <span className="truncate">{name}</span>
                {findGithubRepo({ repos, fullName: name }) ? null : (
                  <span className="font-sans text-muted-foreground">from pasted link</span>
                )}
              </ComboboxItem>
            )}
          </ComboboxList>
          <div className="flex items-center border-t border-border p-1">
            <Button variant="ghost" size="xs" onClick={onRefresh}>
              <RefreshCwIcon data-icon="inline-start" />
              Refresh
            </Button>
          </div>
        </ComboboxContent>
      </Combobox>
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  )
}

export function RepositoryStep({ draft, patch }: { draft: ProjectDraft; patch: DraftPatch }) {
  const query = useGithubRepos()
  return (
    <QueryGate query={query} label="repositories">
      {(repos) =>
        repos === null ? (
          <ConnectGithub />
        ) : (
          <div className="flex flex-col gap-4">
            <RecentTiles repos={repos} draft={draft} patch={patch} />
            <RepoPicker repos={repos} draft={draft} patch={patch} onRefresh={query.reload} />
            <BranchField repos={repos} draft={draft} patch={patch} />
          </div>
        )
      }
    </QueryGate>
  )
}
