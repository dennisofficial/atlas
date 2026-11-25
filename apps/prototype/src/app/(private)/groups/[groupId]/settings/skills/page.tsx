import { GroupSkillsPage } from '@/features/groups/skills-page'

export default async function Page({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params
  return <GroupSkillsPage groupId={groupId} />
}
