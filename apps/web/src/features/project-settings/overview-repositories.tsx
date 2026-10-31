'use client'

import { ArrowUpRightIcon, PlusIcon } from 'lucide-react'
import { useState } from 'react'

import { MAX_ADDITIONAL_REPOS } from '@dltech/atlas-wire/web'
import { Button } from '@dltech/atlas-ui/components/button'

import { useGithubRepos } from '@/features/projects/use-github-repos'

import { AdditionalRepositoryField } from './additional-repository-field'
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
  mainRepository,
  repositories,
  onChange,
}: {
  mainRepository: string | null
  repositories: readonly string[]
  onChange: (next: readonly string[]) => void
}) {
  const githubRepos = useGithubRepos().data ?? []
  const [addedIndex, setAddedIndex] = useState<number | null>(null)
  const taken = mainRepository === null ? repositories : [mainRepository, ...repositories]
  const handleAdd = () => {
    setAddedIndex(repositories.length)
    onChange([...repositories, ''])
  }
  const handleRemove = (index: number) => {
    setAddedIndex(null)
    onChange(repositories.filter((_, position) => position !== index))
  }
  const handleEdit = ({ index, value }: { index: number; value: string }) => {
    onChange(repositories.map((repo, position) => (position === index ? value : repo)))
  }
  return (
    <>
      {repositories.map((repo, index) => (
        <AdditionalRepositoryField
          key={index}
          label={`Additional repository ${index + 1}`}
          repo={repo}
          repos={githubRepos}
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
