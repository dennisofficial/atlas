import { ProjectSkillDetailTweaked } from '@/features/project-settings/tweaks/skill-detail'

export default async function ProjectSkillDetailRoute({
  params,
}: {
  params: Promise<{ projectId: string; skillId: string }>
}) {
  const { skillId } = await params
  return <ProjectSkillDetailTweaked skillName={decodeURIComponent(skillId)} />
}
