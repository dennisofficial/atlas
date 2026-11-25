import { SkillDetailView } from '../settings/pages/skills'

export function GroupSkillDetailPage({ groupId, skillId }: { groupId: string; skillId: string }) {
  return (
    <SkillDetailView
      skillId={skillId}
      scopeLabel="Group"
      listHref={`/groups/${encodeURIComponent(groupId)}/settings/skills`}
    />
  )
}
