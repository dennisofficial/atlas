import { SkillsListView } from '../settings/pages/skills'

export function ProjectSkillsPage({ projectId }: { projectId: string }) {
  return (
    <SkillsListView
      title="Skills"
      description={`Skills stored for ${projectId}, loaded in threads on this project.`}
      detailHref={(name) =>
        `/projects/${encodeURIComponent(projectId)}/settings/skills/${encodeURIComponent(name)}`
      }
    />
  )
}
