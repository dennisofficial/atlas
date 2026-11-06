import { ProjectSkillDetailPage } from '@/features/project-settings/skill-detail'

export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string; skillId: string }>
}) {
  const { projectId, skillId } = await params
  return <ProjectSkillDetailPage projectId={projectId} skillId={skillId} />
}
