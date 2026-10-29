'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { routeIdAfter } from '@/lib/route-id'

import { EProjectSettingsSection, hrefOfProjectSection } from './project-settings-nav'

export function ProjectSettingsIndexRedirect() {
  const router = useRouter()
  const projectId = routeIdAfter({ pathname: usePathname(), segment: 'projects' })

  useEffect(() => {
    router.replace(hrefOfProjectSection({ projectId, section: EProjectSettingsSection.Overview }))
  }, [router, projectId])

  return null
}
