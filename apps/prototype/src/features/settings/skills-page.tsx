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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dltech/atlas-ui/components/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@dltech/atlas-ui/components/table'
import { ToggleGroup, ToggleGroupItem } from '@dltech/atlas-ui/components/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dltech/atlas-ui/components/tooltip'
import { cn } from '@dltech/atlas-ui/lib/utils'

import {
  ESkillLayer,
  SKILL_LAYER_LABELS,
  SKILLS_PROJECT,
  SKILLS_PROJECTS,
  formatSkillDate,
  formatSkillSize,
  isEditableLayer,
  skillIdOf,
  type SkillRow,
} from './fixtures/settings-skills'
import { LibraryConfirmDialog } from './parts/library-confirm-dialog'
import { MemorySelectionBar } from './parts/memory-selection-bar'
import { NewSkillDialog } from './parts/new-skill-dialog'
import { SkillLayerBadge } from './parts/skill-layer-badge'
import { SettingsPage } from './settings-layout'
import { useSkills } from './use-skills'

const ALL_LAYERS = 'all'

function shadowNote(row: SkillRow): string | null {
  if (row.shadowedBy) return `Overridden by ${SKILL_LAYER_LABELS[row.shadowedBy]}`
  if (row.overrides.length > 0) {
    return `Overrides ${row.overrides.map((layer) => SKILL_LAYER_LABELS[layer]).join(' and ')}`
  }
  return null
}

function matches({ row, query, layer }: { row: SkillRow; query: string; layer: string }) {
  const needle = query.trim().toLowerCase()
  const textMatch =
    needle.length === 0 ||
    row.skill.name.toLowerCase().includes(needle) ||
    row.skill.description.toLowerCase().includes(needle)
  return textMatch && (layer === ALL_LAYERS || row.skill.layer === layer)
}

function lockedReason(layer: ESkillLayer): string {
  return layer === ESkillLayer.BuiltIn
    ? 'Built-in skills ship with Atlas and cannot be deleted.'
    : 'Repo skills live in the checkout and change through git.'
}

export function SkillsPage() {
  const router = useRouter()
  const { rows, deleteSkills, createSkill, addSkill } = useSkills()
  const [query, setQuery] = useState('')
  const [layer, setLayer] = useState(ALL_LAYERS)
  const [project, setProject] = useState(SKILLS_PROJECT)
  const [selected, setSelected] = useState<string[]>([])
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null)

  const visible = rows.filter((row) => matches({ row, query, layer }))
  const selectableIds = visible
    .filter((row) => isEditableLayer(row.skill.layer))
    .map((row) => skillIdOf(row.skill))
  const liveSelected = selected.filter((id) => selectableIds.includes(id))

  const handleSelectedChange = ({ id, checked }: { id: string; checked: boolean }) =>
    setSelected((current) =>
      checked
        ? [...current.filter((value) => value !== id), id]
        : current.filter((value) => value !== id),
    )
  const handleLayerChange = (values: string[]) => setLayer(values[0] ?? ALL_LAYERS)
  const handleProjectChange = (next: string | null) => {
    if (next !== null) setProject(next)
  }
  const handleCreate = (args: { name: string; layer: ESkillLayer }) => {
    const skill = createSkill(args)
    addSkill(skill)
    router.push(`/settings/skills/${encodeURIComponent(skillIdOf(skill))}`)
  }
  const handleConfirmDelete = () => {
    if (!pendingDelete) return
    deleteSkills(pendingDelete)
    setSelected((current) => current.filter((id) => !pendingDelete.includes(id)))
    setPendingDelete(null)
  }

  const pendingNames = (pendingDelete ?? [])
    .map((id) => rows.find((row) => skillIdOf(row.skill) === id)?.skill.name)
    .filter((name): name is string => name !== undefined)

  return (
    <SettingsPage
      title="Skills"
      description="Every skill the agent can load, across all layers. The closer layer wins: repo > project > global > built-in."
      actions={<NewSkillDialog onCreate={handleCreate} />}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
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
          <ToggleGroup
            variant="outline"
            size="sm"
            spacing={0}
            value={[layer]}
            onValueChange={handleLayerChange}
            aria-label="Skill layer"
          >
            <ToggleGroupItem value={ALL_LAYERS}>All</ToggleGroupItem>
            {Object.values(ESkillLayer).map((value) => (
              <ToggleGroupItem key={value} value={value}>
                {SKILL_LAYER_LABELS[value]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="ml-auto w-52 max-w-full">
            <Select
              items={SKILLS_PROJECTS.map((value) => ({ value, label: value }))}
              value={project}
              onValueChange={handleProjectChange}
            >
              <SelectTrigger aria-label="Project" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {SKILLS_PROJECTS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Project layer shows skills stored for {project}.
        </p>
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
              <EmptyTitle>No skills match.</EmptyTitle>
              <EmptyDescription>
                Try a different search or clear the layer filter. Repo and built-in skills are
                read-only.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table variant="framed" className="min-w-xl">
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <span className="sr-only">Select</span>
                </TableHead>
                <TableHead>Skill</TableHead>
                <TableHead className="w-24">Layer</TableHead>
                <TableHead className="w-16">Files</TableHead>
                <TableHead className="w-20">Size</TableHead>
                <TableHead className="w-24">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => {
                const id = skillIdOf(row.skill)
                const note = shadowNote(row)
                const editable = isEditableLayer(row.skill.layer)
                return (
                  <TableRow key={id} className={cn(row.shadowedBy !== null && 'opacity-60')}>
                    <TableCell>
                      {editable ? (
                        <Checkbox
                          aria-label={`Select ${row.skill.name}`}
                          checked={liveSelected.includes(id)}
                          onCheckedChange={(checked) =>
                            handleSelectedChange({ id, checked: checked === true })
                          }
                        />
                      ) : (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <span className="flex size-4 cursor-not-allowed items-center justify-center">
                                <span className="size-1.5 rounded-full border border-muted-foreground/60" />
                              </span>
                            }
                          />
                          <TooltipContent>{lockedReason(row.skill.layer)}</TooltipContent>
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <Link
                          href={`/settings/skills/${encodeURIComponent(id)}`}
                          className="w-fit max-w-full truncate font-mono text-xs font-medium hover:underline"
                        >
                          {row.skill.name}
                        </Link>
                        <span className="truncate text-xs text-muted-foreground">
                          {row.skill.description || 'No description yet.'}
                        </span>
                        {note ? (
                          <span className="truncate text-xs text-muted-foreground/80 italic">
                            {note}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <SkillLayerBadge layer={row.skill.layer} />
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">
                      {row.skill.files.length}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">
                      {formatSkillSize(row.skill.files)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatSkillDate(row.skill.updatedAt)}
                    </TableCell>
                  </TableRow>
                )
              })}
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
          pendingNames.length > 0
            ? `${pendingNames.join(', ')}. The agent stops loading ${pendingNames.length === 1 ? 'this skill' : 'these skills'} in new threads. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        onConfirm={handleConfirmDelete}
      />
    </SettingsPage>
  )
}
