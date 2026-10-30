import { FolderGit2 } from 'lucide-react'
import { useRouter } from 'next/navigation'

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@dltech/atlas-ui/components/command'

import { ThreadStatusIcon } from './shell-status-icon'
import {
  ESearchKind,
  searchHrefOf,
  searchItemsOf,
  searchScoreOf,
  type SearchItem,
} from './search-items'
import type { ProjectThreads } from './thread-partition'

export interface SearchPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entries: readonly ProjectThreads[]
}

const filterItem = (_value: string, search: string, keywords?: string[]): number =>
  searchScoreOf({ search, keywords: keywords ?? [] })

function SearchRow({ item, onSelect }: { item: SearchItem; onSelect: (item: SearchItem) => void }) {
  const value = `${item.kind}:${item.id}`
  if (item.kind === ESearchKind.Project) {
    return (
      <CommandItem value={value} keywords={[item.label]} onSelect={() => onSelect(item)}>
        <FolderGit2 className="text-muted-foreground" />
        <span className="truncate">{item.label}</span>
      </CommandItem>
    )
  }
  return (
    <CommandItem value={value} keywords={[item.label]} onSelect={() => onSelect(item)}>
      <ThreadStatusIcon status={item.status} />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      <CommandShortcut className="shrink-0 tracking-normal">{item.projectName}</CommandShortcut>
    </CommandItem>
  )
}

export function SearchPalette({ open, onOpenChange, entries }: SearchPaletteProps) {
  const router = useRouter()
  const { threads, projects } = searchItemsOf(entries)

  const handleSelect = (item: SearchItem) => {
    onOpenChange(false)
    router.push(searchHrefOf(item))
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Search threads and projects"
    >
      <Command filter={filterItem}>
        <CommandInput placeholder="Search threads and projects…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          {threads.length > 0 && (
            <CommandGroup heading="Threads">
              {threads.map((item) => (
                <SearchRow key={item.id} item={item} onSelect={handleSelect} />
              ))}
            </CommandGroup>
          )}
          {projects.length > 0 && (
            <CommandGroup heading="Projects">
              {projects.map((item) => (
                <SearchRow key={item.id} item={item} onSelect={handleSelect} />
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
