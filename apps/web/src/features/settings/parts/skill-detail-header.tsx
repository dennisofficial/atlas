'use client'

import Link from 'next/link'
import { ArrowLeftIcon, Trash2Icon } from 'lucide-react'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'

import { formatSkillDate } from './skill-format'

export function SkillDetailHeader({
  name,
  updatedAt,
  listHref,
  readOnly = false,
  onDeleteSkill,
}: {
  name: string
  updatedAt: string | null
  listHref: string
  readOnly?: boolean
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
          <h1 className="font-mono text-base font-semibold">{name}</h1>
          {readOnly ? <Badge variant="secondary">Built-in</Badge> : null}
          {updatedAt === null ? null : (
            <span className="text-xs text-muted-foreground">
              Updated {formatSkillDate(updatedAt)}
            </span>
          )}
        </div>
      </div>
      {readOnly ? null : (
        <Button variant="outline" size="sm" onClick={onDeleteSkill}>
          <Trash2Icon data-icon="inline-start" />
          Delete skill
        </Button>
      )}
    </header>
  )
}
