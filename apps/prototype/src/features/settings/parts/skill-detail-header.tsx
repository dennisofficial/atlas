'use client'

import Link from 'next/link'
import { ArrowLeftIcon, Trash2Icon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'

import { formatSkillDate, type Skill } from '../fixtures/settings-skills'

export function SkillDetailHeader({
  skill,
  listHref,
  onDeleteSkill,
}: {
  skill: Skill
  listHref: string
  onDeleteSkill: () => void
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <Button
          variant="ghost"
          size="xs"
          nativeButton={false}
          render={<Link href={listHref} />}
          className="w-fit text-muted-foreground"
        >
          <ArrowLeftIcon data-icon="inline-start" />
          Skills
        </Button>
        <div className="flex items-center gap-2">
          <h1 className="font-mono text-base font-semibold">{skill.name}</h1>
          <span className="text-xs text-muted-foreground">
            Updated {formatSkillDate(skill.updatedAt)}
          </span>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={onDeleteSkill}>
        <Trash2Icon data-icon="inline-start" />
        Delete skill
      </Button>
    </header>
  )
}
