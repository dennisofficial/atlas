import { FolderGit2Icon, PlusIcon, XIcon } from 'lucide-react'
import { useState } from 'react'

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

import { MAX_ADDITIONAL_REPOS } from './new-project-draft'
import { NEW_PROJECT_REPOS } from './new-project-fixtures'
import { additionalRepoChoices, findGithubRepo } from './new-project-repos'

function AdditionalRepositoryField({
  label,
  repo,
  taken,
  autoOpen,
  onChange,
  onRemove,
}: {
  label: string
  repo: string
  taken: readonly string[]
  autoOpen: boolean
  onChange: (next: string) => void
  onRemove: () => void
}) {
  const choices = additionalRepoChoices({ repos: NEW_PROJECT_REPOS, query: repo, taken })
  const [open, setOpen] = useState(autoOpen)
  const handleOpenChange = (next: boolean) => setOpen(next)
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
      open={open}
      onOpenChange={handleOpenChange}
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
              {findGithubRepo({ repos: NEW_PROJECT_REPOS, fullName: name }) ? null : (
                <span className="font-sans text-muted-foreground">from pasted link</span>
              )}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

export function NewProjectAdditionalRepos({
  mainRepository,
  repositories,
  onChange,
}: {
  mainRepository: string
  repositories: readonly string[]
  onChange: (next: readonly string[]) => void
}) {
  const [addedIndex, setAddedIndex] = useState<number | null>(null)
  const taken = [mainRepository, ...repositories]
  const handleAdd = () => {
    setAddedIndex(repositories.length)
    onChange([...repositories, ''])
  }
  const handleRemove = (index: number) => {
    setAddedIndex(null)
    onChange(repositories.filter((_, position) => position !== index))
  }
  const handleEdit = ({ index, value }: { index: number; value: string }) =>
    onChange(repositories.map((repo, position) => (position === index ? value : repo)))

  return (
    <>
      {repositories.map((repo, index) => (
        <AdditionalRepositoryField
          key={index}
          label={`Additional repository ${index + 1}`}
          repo={repo}
          taken={taken}
          autoOpen={index === addedIndex}
          onChange={(value) => handleEdit({ index, value })}
          onRemove={() => handleRemove(index)}
        />
      ))}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        disabled={repositories.length >= MAX_ADDITIONAL_REPOS}
        onClick={handleAdd}
      >
        <PlusIcon data-icon="inline-start" />
        Add repository
      </Button>
    </>
  )
}
