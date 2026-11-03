'use client'

import Link from 'next/link'
import { ArrowLeftIcon, ExternalLinkIcon, Trash2Icon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'

import {
  ESkillLayer,
  REPO_SOURCE_URL,
  SKILL_LAYER_LABELS,
  formatSkillDate,
  skillIdOf,
  type Skill,
  type SkillRow,
} from '../fixtures/settings-skills'
import { SkillLayerBadge } from './skill-layer-badge'

function shadowText({ skill, rows }: { skill: Skill; rows: SkillRow[] }) {
  const row = rows.find((candidate) => skillIdOf(candidate.skill) === skillIdOf(skill))
  if (!row) return null
  if (row.shadowedBy) return `Overridden by the ${SKILL_LAYER_LABELS[row.shadowedBy]} layer.`
  if (row.overrides.length > 0) {
    return `Overrides ${row.overrides.map((layer) => SKILL_LAYER_LABELS[layer]).join(' and ')}.`
  }
  return null
}

function ReadOnlyNote({ layer }: { layer: ESkillLayer }) {
  if (layer !== ESkillLayer.Repo) {
    return (
      <p className="text-sm text-muted-foreground">
        Built-in skills ship with Atlas and are read-only.
      </p>
    )
  }
  return (
    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
      Edit in the repository
      <Button
        variant="ghost"
        size="xs"
        nativeButton={false}
        render={<a href={REPO_SOURCE_URL} target="_blank" rel="noreferrer" />}
      >
        <ExternalLinkIcon data-icon="inline-start" />
        dennisofficial/atlas
      </Button>
    </p>
  )
}

export function SkillDetailHeader({
  skill,
  rows,
  editable,
  onDeleteSkill,
}: {
  skill: Skill
  rows: SkillRow[]
  editable: boolean
  onDeleteSkill: () => void
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <Button
          variant="ghost"
          size="xs"
          nativeButton={false}
          render={<Link href="/settings/skills" />}
          className="w-fit text-muted-foreground"
        >
          <ArrowLeftIcon data-icon="inline-start" />
          Skills
        </Button>
        <div className="flex items-center gap-2">
          <h1 className="font-mono text-base font-semibold">{skill.name}</h1>
          <SkillLayerBadge layer={skill.layer} />
          <span className="text-xs text-muted-foreground">
            Updated {formatSkillDate(skill.updatedAt)}
          </span>
        </div>
        {shadowText({ skill, rows }) ? (
          <p className="text-sm text-muted-foreground">{shadowText({ skill, rows })}</p>
        ) : null}
        {!editable ? <ReadOnlyNote layer={skill.layer} /> : null}
      </div>
      {editable ? (
        <Button variant="outline" size="sm" onClick={onDeleteSkill}>
          <Trash2Icon data-icon="inline-start" />
          Delete skill
        </Button>
      ) : null}
    </header>
  )
}
