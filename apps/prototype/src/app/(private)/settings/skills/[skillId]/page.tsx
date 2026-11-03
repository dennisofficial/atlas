import { SkillDetailTweaked } from '@/features/settings/tweaks/skill-detail'

export default async function SkillDetailRoute({
  params,
}: {
  params: Promise<{ skillId: string }>
}) {
  const { skillId } = await params
  return <SkillDetailTweaked skillName={decodeURIComponent(skillId)} />
}
