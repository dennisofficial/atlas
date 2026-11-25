'use client'

import { useMemo } from 'react'

import { SkillDetailPage } from '@/features/settings/parts/skill-detail-view'
import {
  sectionHrefOf,
  skillTargetOf,
  useSettingsScope,
} from '@/features/settings/scope/settings-scope'
import { useRouteParam } from '@/lib/route-param'

export function SettingsSkillDetailPage() {
  const scope = useSettingsScope()
  const skill = useRouteParam('skillId')
  const target = useMemo(() => skillTargetOf(scope), [scope])
  return (
    <SkillDetailPage
      target={{ ...target, skill }}
      listHref={sectionHrefOf({ scope, section: 'skills' })}
      scopeLabel={scope.kind === 'project' ? 'Project' : 'Group'}
    />
  )
}
