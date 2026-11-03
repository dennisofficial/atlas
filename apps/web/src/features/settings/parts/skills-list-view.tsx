'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { FolderTreeIcon, SearchIcon } from 'lucide-react'
import type { SkillSummary } from '@dltech/atlas-wire/web'

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

import { QueryPage } from '../data/personal/query-boundary'
import { runAction } from '../data/shared/run-action'
import { useSkills, type SkillScopeTarget } from '../data/shared/use-skills'
import { LibraryConfirmDialog } from './library-confirm-dialog'
import { MemorySelectionBar } from './memory-selection-bar'
import { NewSkillDialog } from './new-skill-dialog'
import { SKILL_PRECEDENCE_COPY, formatBytes, formatSkillDate } from './skill-format'
import {
  cycleSkillSort,
  ESkillSortKey,
  ESortDirection,
  orderSkills,
  type SkillSort,
} from './skill-list-order'
import { SortableHead, UsageCell } from './skills-table-cells'
import { SettingsPage } from '../settings-layout'
import { SkillsTableSkeleton } from '../skeletons/skill-skeletons'

export { ESkillSortKey, ESortDirection, orderSkills }

function matches({ skill, query }: { skill: SkillSummary; query: string }) {
  const needle = query.trim().toLowerCase()
  return (
    needle.length === 0 ||
    skill.name.toLowerCase().includes(needle) ||
    skill.description.toLowerCase().includes(needle)
  )
}

export function SkillsListPage({
  target,
  title,
  description,
  detailHref,
}: {
  target: SkillScopeTarget
  title: string
  description: string
  detailHref: (name: string) => string
}) {
  const skills = useSkills(target)
  return (
    <QueryPage
      query={skills.query}
      title={title}
      description={`${description} ${SKILL_PRECEDENCE_COPY}`}
      skeleton={<SkillsTableSkeleton />}
    >
      {(snapshot) => (
        <SkillsTable
          skills={snapshot.skills}
          now={snapshot.fetchedAt}
          title={title}
          description={description}
          detailHref={detailHref}
          createSkill={skills.createSkill}
          deleteSkills={skills.deleteSkills}
        />
      )}
    </QueryPage>
  )
}

export function SkillsTable({
  skills,
  now,
  title,
  description,
  detailHref,
  createSkill,
  deleteSkills,
}: {
  skills: SkillSummary[]
  now: number
  title: string
  description: string
  detailHref: (name: string) => string
  createSkill: (name: string) => Promise<void>
  deleteSkills: (names: string[]) => Promise<void>
}) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SkillSort>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)

  const visible = orderSkills({
    skills: skills.filter((skill) => matches({ skill, query: search })),
    sort,
  })
  const liveSelected = selected.filter((name) => visible.some((skill) => skill.name === name))

  const handleSelectedChange = ({ name, checked }: { name: string; checked: boolean }) =>
    setSelected((current) =>
      checked
        ? [...current.filter((value) => value !== name), name]
        : current.filter((value) => value !== name),
    )
  const handleSort = (key: ESkillSortKey) => setSort((current) => cycleSkillSort({ current, key }))
  const handleCreate = async (name: string): Promise<boolean> => {
    setBusy(true)
    const created = await runAction({ work: () => createSkill(name) })
    setBusy(false)
    if (!created) return false
    router.push(detailHref(name))
    return true
  }
  const handleConfirmDelete = () => {
    if (!pendingDelete) return
    const names = pendingDelete
    setPendingDelete(null)
    void runAction({
      work: () => deleteSkills(names),
      success: `Deleted ${names.length} ${names.length === 1 ? 'skill' : 'skills'}`,
    }).then((done) => {
      if (done) setSelected((current) => current.filter((name) => !names.includes(name)))
    })
  }

  return (
    <SettingsPage
      title={title}
      description={`${description} ${SKILL_PRECEDENCE_COPY}`}
      actions={<NewSkillDialog onCreate={handleCreate} busy={busy} />}
    >
      <div className="flex flex-col gap-3">
        <InputGroup className="w-56">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search skills"
            placeholder="Search skills…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
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
          <Empty variant="outline">
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
                <SortableHead
                  label="Skill"
                  sortKey={ESkillSortKey.Name}
                  sort={sort}
                  onSort={handleSort}
                />
                <SortableHead
                  label="Usage"
                  sortKey={ESkillSortKey.Usage}
                  sort={sort}
                  onSort={handleSort}
                  className="w-28"
                />
                <TableHead className="w-16">Files</TableHead>
                <TableHead className="w-20">Size</TableHead>
                <TableHead className="w-24">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((skill) => (
                <TableRow
                  key={skill.name}
                  className="cursor-pointer"
                  onClick={() => router.push(detailHref(skill.name))}
                >
                  <TableCell onClick={(event) => event.stopPropagation()}>
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
                        onClick={(event) => event.stopPropagation()}
                        className="w-fit max-w-full truncate font-mono text-xs font-medium hover:underline"
                      >
                        {skill.name}
                      </Link>
                      <span className="truncate text-xs text-muted-foreground">
                        {skill.description || 'No description yet.'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <UsageCell skill={skill} now={now} />
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">
                    {skill.fileCount}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">
                    {formatBytes(skill.sizeBytes)}
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
