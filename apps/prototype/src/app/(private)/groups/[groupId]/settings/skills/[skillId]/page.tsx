import { GroupSkillDetailPage } from '@/features/groups/skill-detail'

export default async function Page({
  params,
}: {
  params: Promise<{ groupId: string; skillId: string }>
}) {
  const { groupId, skillId } = await params
  return <GroupSkillDetailPage groupId={groupId} skillId={skillId} />
}
