import { SearchIcon } from 'lucide-react'

import { Avatar, AvatarFallback } from '@dltech/atlas-ui/components/avatar'
import { Button } from '@dltech/atlas-ui/components/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@dltech/atlas-ui/components/input-group'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { EOwnerKind, type ProjectOwner } from './projects.fixtures'

interface OwnerListProps {
  owners: ProjectOwner[]
  selectedId: string | null
  query: string
  onQueryChange: (query: string) => void
  onSelect: (ownerId: string | null) => void
}

function OwnerMark({ owner }: { owner: ProjectOwner }) {
  if (owner.kind === EOwnerKind.Personal) {
    return (
      <Avatar size="sm">
        <AvatarFallback>{owner.initials}</AvatarFallback>
      </Avatar>
    )
  }
  return (
    <span
      aria-hidden
      className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-xs font-semibold"
    >
      {owner.initials}
    </span>
  )
}

export function OwnerList({ owners, selectedId, query, onQueryChange, onSelect }: OwnerListProps) {
  const handleQueryChange = (event: React.ChangeEvent<HTMLInputElement>) =>
    onQueryChange(event.target.value)
  return (
    <div className="flex w-40 shrink-0 flex-col gap-3">
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          value={query}
          onChange={handleQueryChange}
          placeholder="Search projects…"
          aria-label="Search projects"
        />
      </InputGroup>
      <nav aria-label="Project owners" className="flex flex-col gap-0.5">
        {owners.map((owner) => (
          <button
            key={owner.id}
            type="button"
            aria-pressed={selectedId === owner.id}
            onClick={() => onSelect(owner.id)}
            className={cn(
              'flex items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50',
              selectedId === owner.id && 'bg-muted',
            )}
          >
            <OwnerMark owner={owner} />
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-sm font-medium">{owner.name}</span>
              <span className="text-xs text-muted-foreground">{owner.kind}</span>
            </span>
          </button>
        ))}
      </nav>
      <Button
        variant="link"
        size="sm"
        className={cn(
          'justify-start px-2 text-muted-foreground hover:text-foreground',
          selectedId === null && 'text-foreground',
        )}
        onClick={() => onSelect(null)}
      >
        Show all projects
      </Button>
    </div>
  )
}
