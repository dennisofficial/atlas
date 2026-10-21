'use client'

import { ArrowUpRightIcon, FolderGit2Icon, PlusIcon, XIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@dltech/atlas-ui/components/input-group'

import type { ProjectIdentity } from './data/project-mapping'

export function RepositoryControls({ identity }: { identity: ProjectIdentity }) {
  if (identity.repo === null) {
    return <span className="text-sm text-muted-foreground">No repository connected</span>
  }
  return (
    <>
      <a
        href={`https://github.com/${identity.repo}`}
        target="_blank"
        rel="noreferrer"
        className="mr-auto inline-flex min-w-0 items-center gap-1 font-mono text-sm text-foreground underline-offset-4 hover:underline sm:mr-0"
      >
        <span className="truncate">{identity.repo}</span>
        <ArrowUpRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </a>
    </>
  )
}

export function AdditionalRepositories({
  repositories,
  onChange,
}: {
  repositories: readonly string[]
  onChange: (next: readonly string[]) => void
}) {
  const handleRemove = (index: number) => {
    onChange(repositories.filter((_, position) => position !== index))
  }
  const handleEdit = ({ index, value }: { index: number; value: string }) => {
    onChange(repositories.map((repo, position) => (position === index ? value : repo)))
  }
  return (
    <>
      {repositories.map((repo, index) => (
        <InputGroup key={index}>
          <InputGroupAddon>
            <FolderGit2Icon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label={`Additional repository ${index + 1}`}
            className="font-mono"
            placeholder="owner/repo"
            value={repo}
            onChange={(event) => handleEdit({ index, value: event.target.value })}
          />
          <InputGroupAddon align="inline-end">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove ${repo || 'repository'}`}
              onClick={() => handleRemove(index)}
            >
              <XIcon />
            </Button>
          </InputGroupAddon>
        </InputGroup>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => onChange([...repositories, ''])}
      >
        <PlusIcon data-icon="inline-start" />
        Add repository
      </Button>
    </>
  )
}
