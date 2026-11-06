import { ProjectSkillsPage } from '@/features/project-settings/skills-page'

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  return <ProjectSkillsPage projectId={projectId} />
}
