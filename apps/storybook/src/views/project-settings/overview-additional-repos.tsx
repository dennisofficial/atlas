import { PlusIcon, XIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '@dltech/atlas-ui/components/combobox'

import type { GithubRepo } from '../../fixtures/project-settings'
import { availableRepoSlugs, findRepo } from './overview-model'
import { RepoAvatar } from './overview-repo-avatar'

function ownerOf(slug: string): string {
  return slug.split('/')[0] ?? slug
}

function AddedRepoRow({ slug, onRemove }: { slug: string; onRemove: () => void }) {
  const repo = findRepo(slug)
  return (
    <li className="flex items-center gap-3 rounded-md border bg-background py-1.5 pr-1.5 pl-2.5">
      <RepoAvatar owner={ownerOf(slug)} avatarUrl={repo?.avatarUrl ?? null} size="sm" />
      <span className="min-w-0 flex-1 truncate font-mono text-sm">{slug}</span>
      <Button variant="ghost" size="icon-xs" aria-label={`Remove ${slug}`} onClick={onRemove}>
        <XIcon />
      </Button>
    </li>
  )
}

export function AdditionalRepositories({
  project,
  repositories,
  onChange,
  defaultOpen,
}: {
  project: GithubRepo
  repositories: readonly string[]
  onChange: (next: readonly string[]) => void
  defaultOpen?: boolean
}) {
  const options = availableRepoSlugs({ project, added: repositories })

  const handleRemove = (slug: string) => {
    onChange(repositories.filter((repo) => repo !== slug))
  }

  const handleAdd = (slug: string | null) => {
    if (slug === null) return
    onChange([...repositories, slug])
  }

  return (
    <>
      {repositories.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {repositories.map((slug) => (
            <AddedRepoRow key={slug} slug={slug} onRemove={() => handleRemove(slug)} />
          ))}
        </ul>
      ) : null}
      <Combobox
        items={options}
        value={null}
        onValueChange={handleAdd}
        defaultOpen={defaultOpen}
        disabled={options.length === 0}
      >
        <ComboboxTrigger
          render={<Button variant="outline" size="sm" className="self-start font-normal" />}
        >
          <PlusIcon data-icon="inline-start" />
          Add repository
        </ComboboxTrigger>
        <ComboboxContent className="w-96">
          <ComboboxInput showTrigger={false} placeholder="Search your repositories" />
          <ComboboxEmpty>No repositories found.</ComboboxEmpty>
          <ComboboxList>
            {(slug: string) => (
              <ComboboxItem key={slug} value={slug}>
                <RepoAvatar
                  owner={ownerOf(slug)}
                  avatarUrl={findRepo(slug)?.avatarUrl ?? null}
                  size="sm"
                />
                <span className="truncate font-mono text-xs">{slug}</span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </>
  )
}
