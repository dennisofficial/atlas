'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { FolderTreeIcon, SearchIcon } from 'lucide-react'

import { Checkbox } from '@dltech/atlas-ui/components/checkbox'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@dltech/atlas-ui/components/empty'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@dltech/atlas-ui/components/input-group'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@dltech/atlas-ui/components/table'

import {
  SKILL_PRECEDENCE_COPY,
  formatSkillDate,
  formatSkillSize,
  type ESkillOwner,
  type Skill,
} from './fixtures/settings-skills'
import { LibraryConfirmDialog } from './parts/library-confirm-dialog'
import { MemorySelectionBar } from './parts/memory-selection-bar'
import { NewSkillDialog } from './parts/new-skill-dialog'
import { SettingsPage } from './settings-layout'
import { useSkills } from './use-skills'

function matches({ skill, query }: { skill: Skill; query: string }) {
  const needle = query.trim().toLowerCase()
  return (
    needle.length === 0 ||
    skill.name.toLowerCase().includes(needle) ||
    skill.description.toLowerCase().includes(needle)
  )
}

export function SkillsPage({
  owner,
  title,
  description,
  detailHref,
}: {
  owner: ESkillOwner
  title: string
  description: string
  detailHref: (name: string) => string
}) {
  const router = useRouter()
  const { skills, deleteSkills, createSkill, addSkill } = useSkills({ owner })
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null)

  const visible = skills.filter((skill) => matches({ skill, query }))
  const liveSelected = selected.filter((name) => visible.some((skill) => skill.name === name))

  const handleSelectedChange = ({ name, checked }: { name: string; checked: boolean }) =>
    setSelected((current) =>
      checked
        ? [...current.filter((value) => value !== name), name]
        : current.filter((value) => value !== name),
    )
  const handleCreate = (name: string) => {
    const skill = createSkill(name)
    addSkill(skill)
    router.push(detailHref(skill.name))
  }
  const handleConfirmDelete = () => {
    if (!pendingDelete) return
    deleteSkills(pendingDelete)
    setSelected((current) => current.filter((name) => !pendingDelete.includes(name)))
    setPendingDelete(null)
  }

  return (
    <SettingsPage
      title={title}
      description={`${description} ${SKILL_PRECEDENCE_COPY}`}
      actions={<NewSkillDialog onCreate={handleCreate} />}
    >
      <div className="flex flex-col gap-3">
        <InputGroup className="w-56">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search skills"
            placeholder="Search skills…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </InputGroup>
        {liveSelected.length > 0 ? (
          <MemorySelectionBar
            count={liveSelected.length}
            onDelete={() => setPendingDelete(liveSelected)}
            onClear={() => setSelected([])}
          />
        ) : null}
        {visible.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderTreeIcon />
              </EmptyMedia>
              <EmptyTitle>
                {skills.length === 0 ? 'No skills here yet' : 'No skills match.'}
              </EmptyTitle>
              <EmptyDescription>
                {skills.length === 0
                  ? 'Create one with the New skill button — it starts as an empty SKILL.md.'
                  : 'Try a different search.'}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table variant="framed" className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <span className="sr-only">Select</span>
                </TableHead>
                <TableHead>Skill</TableHead>
                <TableHead className="w-16">Files</TableHead>
                <TableHead className="w-20">Size</TableHead>
                <TableHead className="w-24">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((skill) => (
                <TableRow key={skill.name}>
                  <TableCell>
                    <Checkbox
                      aria-label={`Select ${skill.name}`}
                      checked={liveSelected.includes(skill.name)}
                      onCheckedChange={(checked) =>
                        handleSelectedChange({ name: skill.name, checked: checked === true })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <Link
                        href={detailHref(skill.name)}
                        className="w-fit max-w-full truncate font-mono text-xs font-medium hover:underline"
                      >
                        {skill.name}
                      </Link>
                      <span className="truncate text-xs text-muted-foreground">
                        {skill.description || 'No description yet.'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">
                    {skill.files.length}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">
                    {formatSkillSize(skill.files)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatSkillDate(skill.updatedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <LibraryConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title={`Delete ${pendingDelete?.length ?? 0} ${(pendingDelete?.length ?? 0) === 1 ? 'skill' : 'skills'}?`}
        description={
          pendingDelete !== null && pendingDelete.length > 0
            ? `${pendingDelete.join(', ')}. The agent stops loading ${pendingDelete.length === 1 ? 'this skill' : 'these skills'} in new threads. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        onConfirm={handleConfirmDelete}
      />
    </SettingsPage>
  )
}
