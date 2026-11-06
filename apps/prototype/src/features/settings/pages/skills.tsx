import Link from 'next/link'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@dltech/atlas-ui/components/table'

import { SKILL_ROWS, skillByName } from '../fixtures/settings-skills'
import { SettingsPage } from '../settings-layout'

export function SkillsListView({
  title,
  description,
  detailHref,
}: {
  title: string
  description: string
  detailHref: (name: string) => string
}) {
  return (
    <SettingsPage title={title} description={description}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {SKILL_ROWS.map((skill) => (
            <TableRow key={skill.name}>
              <TableCell>
                <Link href={detailHref(skill.name)} className="font-mono text-sm hover:underline">
                  {skill.name}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">{skill.description}</TableCell>
              <TableCell className="text-muted-foreground">{skill.updatedAt}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </SettingsPage>
  )
}

export function SkillDetailView({
  skillId,
  scopeLabel,
  listHref,
}: {
  skillId: string
  scopeLabel: string
  listHref: string
}) {
  const skill = skillByName(skillId)
  return (
    <SettingsPage
      title={skillId}
      description={
        skill === null
          ? `No ${scopeLabel.toLowerCase()} skill named ${skillId}.`
          : skill.description
      }
      actions={
        <Link href={listHref} className="text-sm text-muted-foreground hover:underline">
          All skills
        </Link>
      }
    >
      <p className="text-sm text-muted-foreground">{scopeLabel} skill</p>
    </SettingsPage>
  )
}

export function SkillsPage() {
  return (
    <SkillsListView
      title="Skills"
      description="Your personal skills, loaded in every thread on every project."
      detailHref={(name) => `/settings/skills/${encodeURIComponent(name)}`}
    />
  )
}

export function SkillDetailRoute({ skillId }: { skillId: string }) {
  return <SkillDetailView skillId={skillId} scopeLabel="Personal" listHref="/settings/skills" />
}
