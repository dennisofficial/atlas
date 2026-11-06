import { SkillDetailView } from '../settings/pages/skills'

export function ProjectSkillDetailPage({
  projectId,
  skillId,
}: {
  projectId: string
  skillId: string
}) {
  return (
    <SkillDetailView
      skillId={skillId}
      scopeLabel="Project"
      listHref={`/projects/${encodeURIComponent(projectId)}/settings/skills`}
    />
  )
}
