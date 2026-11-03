import { ProjectSkillDetailPage } from '@/features/project-settings/skill-detail'
import { STATIC_EXPORT_PLACEHOLDER, staticParamsForDesktop } from '@/lib/route-id'

export function generateStaticParams() {
  return staticParamsForDesktop({ skillId: STATIC_EXPORT_PLACEHOLDER })
}

export default function Page() {
  return <ProjectSkillDetailPage />
}
