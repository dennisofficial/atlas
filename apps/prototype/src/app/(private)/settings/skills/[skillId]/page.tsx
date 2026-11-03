import { notFound } from 'next/navigation'

import { parseSkillId } from '@/features/settings/fixtures/settings-skills'
import { SkillDetailTweaked } from '@/features/settings/tweaks/skill-detail'

export default async function SkillDetailRoute({
  params,
}: {
  params: Promise<{ skillId: string }>
}) {
  const { skillId } = await params
  const parsed = parseSkillId(skillId)
  if (!parsed) notFound()
  return <SkillDetailTweaked skillId={skillId} />
}
