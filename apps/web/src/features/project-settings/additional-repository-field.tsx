'use client'

import { FolderGit2Icon, XIcon } from 'lucide-react'

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
import { InputGroupAddon } from '@dltech/atlas-ui/components/input-group'

import { findGithubRepo } from '@/features/projects/new-project-repos'

import { additionalRepoChoices } from './data/additional-repo-choices'

export function AdditionalRepositoryField({
  label,
  repo,
  repos,
  taken,
  autoOpen = false,
  onChange,
  onRemove,
}: {
  label: string
  repo: string
  repos: readonly GithubRepoSummary[]
  taken: readonly string[]
  autoOpen?: boolean
  onChange: (next: string) => void
  onRemove: () => void
}) {
  const choices = additionalRepoChoices({ repos, query: repo, taken })
  const handleValueChange = (next: string | null) => {
    if (next !== null) onChange(next)
  }
  const handleInputChange = (next: string, details: { reason: string }) => {
    if (details.reason !== 'input-change') return
    onChange(next)
  }

  return (
    <Combobox
      items={choices}
      filter={null}
      autoHighlight
      defaultOpen={autoOpen}
      value={repo === '' ? null : repo}
      onValueChange={handleValueChange}
      inputValue={repo}
      onInputValueChange={handleInputChange}
    >
      <ComboboxInput
        aria-label={label}
        autoFocus={autoOpen}
        className="font-mono"
        placeholder="Search, or paste a GitHub URL or owner/name"
        autoComplete="off"
        spellCheck={false}
        showTrigger={false}
      >
        <InputGroupAddon>
          <FolderGit2Icon />
        </InputGroupAddon>
        <InputGroupAddon align="inline-end">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Remove ${repo || 'repository'}`}
            onClick={onRemove}
          >
            <XIcon />
          </Button>
        </InputGroupAddon>
      </ComboboxInput>
      <ComboboxContent>
        <ComboboxEmpty>
          {repo.trim() ? 'No repositories match.' : 'Paste a GitHub URL or owner/name.'}
        </ComboboxEmpty>
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
      </ComboboxContent>
    </Combobox>
  )
}
