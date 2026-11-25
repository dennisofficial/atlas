import { SkillsListView } from '../settings/pages/skills'
import { InheritedLayersPreview, PERSONAL_SKILLS_LAYER } from './inherited-layers-preview'

export function GroupSkillsPage({ groupId }: { groupId: string }) {
  return (
    <>
      <InheritedLayersPreview layers={[PERSONAL_SKILLS_LAYER]} />
      <SkillsListView
        title="Skills"
        description={`Skills stored for this group, loaded in every project in it.`}
        detailHref={(name) =>
          `/groups/${encodeURIComponent(groupId)}/settings/skills/${encodeURIComponent(name)}`
        }
      />
    </>
  )
}
