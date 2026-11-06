import { SkillDetailRoute } from '@/features/settings/pages/skills'

export default async function Page({ params }: { params: Promise<{ skillId: string }> }) {
  const { skillId } = await params
  return <SkillDetailRoute skillId={skillId} />
}
