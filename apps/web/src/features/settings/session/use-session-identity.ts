'use client'

import { useEffect, useState } from 'react'

import { sessionUser, type SessionUser } from '@/lib/auth-api'
import { activeOrganizationId, listOrganizations } from '@/lib/organization-api'

const NO_WORKSPACE = 'No workspace'

export function useSessionUser(): { user: SessionUser | null; ready: boolean } {
  const [state, setState] = useState<{ user: SessionUser | null; ready: boolean }>({
    user: null,
    ready: false,
  })
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const user = await sessionUser().catch(() => null)
      if (!cancelled) setState({ user, ready: true })
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])
  return state
}

export function useWorkspaceName(): string {
  const [name, setName] = useState(NO_WORKSPACE)
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const [organizations, activeId] = await Promise.all([
        listOrganizations().catch(() => []),
        activeOrganizationId().catch(() => null),
      ])
      const active = organizations.find((organization) => organization.id === activeId)
      const chosen = active ?? organizations[0]
      if (!cancelled) setName(chosen?.name ?? NO_WORKSPACE)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])
  return name
}
