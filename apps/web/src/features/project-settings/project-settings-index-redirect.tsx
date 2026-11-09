'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { useRouteParam } from '@/lib/route-param'

import { EProjectSettingsSection, hrefOfProjectSection } from './project-settings-nav'

export function ProjectSettingsIndexRedirect() {
  const router = useRouter()
  const projectId = useRouteParam('projectId')

  useEffect(() => {
    router.replace(hrefOfProjectSection({ projectId, section: EProjectSettingsSection.Overview }))
  }, [router, projectId])

  return null
}
