'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { sessionUserPresent } from '../../lib/auth-api'
import {
  FactoryApiError,
  getFactorySettings,
  listConnections,
  listWorkItems,
  type FactoryConnection,
  type FactorySettings,
  type FactoryWorkItem,
} from '../../lib/factory-api'
import {
  activeOrganizationId,
  listOrganizations,
  type Organization,
} from '../../lib/organization-api'
import { ConnectionsCard } from './connections-card'
import { OrganizationCard } from './organization-card'
import { SettingsCard } from './settings-card'
import { WorkItemsCard } from './work-items-card'

type FactoryData = {
  organizations: Organization[]
  activeOrganizationId: string | null
  organizationMissing: boolean
  connections: FactoryConnection[]
  settings: FactorySettings | null
  workItems: FactoryWorkItem[]
}

type InstallNotice = { tone: 'success' | 'destructive'; text: string }

function readInstallNotice(params: URLSearchParams): InstallNotice | null {
  const linear = params.get('linear')
  if (linear === 'success') return { tone: 'success', text: 'Linear connected.' }
  if (linear === 'error') {
    return { tone: 'destructive', text: 'The Linear connection failed — try again.' }
  }
  const github = params.get('github')
  if (github === 'installed') return { tone: 'success', text: 'GitHub connected.' }
  if (github === 'error') {
    return { tone: 'destructive', text: 'The GitHub connection failed — try again.' }
  }
  return null
}

export function FactoryDashboard() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [data, setData] = useState<FactoryData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [noticeDismissed, setNoticeDismissed] = useState(false)

  const notice = readInstallNotice(searchParams)

  const load = useCallback(async (): Promise<void> => {
    const [organizations, activeId] = await Promise.all([
      listOrganizations(),
      activeOrganizationId(),
    ])

    let connections: FactoryConnection[] = []
    let settings: FactorySettings | null = null
    let workItems: FactoryWorkItem[] = []
    let organizationMissing = false
    try {
      ;[connections, settings, workItems] = await Promise.all([
        listConnections(),
        getFactorySettings(),
        listWorkItems({ limit: 50 }),
      ])
    } catch (cause) {
      if (cause instanceof FactoryApiError && cause.status === 400) {
        organizationMissing = true
      } else if (cause instanceof FactoryApiError && cause.status === 401) {
        router.replace('/sign-in')
        return
      } else {
        throw cause
      }
    }

    setData({
      organizations,
      activeOrganizationId: activeId,
      organizationMissing,
      connections,
      settings,
      workItems,
    })
    setError(null)
  }, [router])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const present = await sessionUserPresent()
        if (!present) {
          router.replace('/sign-in')
          return
        }
        if (!cancelled) await load()
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Could not load the factory')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [load, router])

  const handleReload = useCallback(async () => {
    await load()
  }, [load])

  const handleDismissNotice = useCallback(() => {
    setNoticeDismissed(true)
  }, [])

  if (data === null) {
    return (
      <p className="text-sm text-meta">{error ?? 'Loading…'}</p>
    )
  }

  return (
    <div className="flex w-full flex-col gap-6">
      {notice !== null && !noticeDismissed ? (
        <div
          className={
            notice.tone === 'success'
              ? 'flex items-center justify-between rounded-md border border-border bg-muted px-4 py-3 text-sm text-success'
              : 'flex items-center justify-between rounded-md border border-border bg-muted px-4 py-3 text-sm text-destructive'
          }
        >
          <span>{notice.text}</span>
          <button
            type="button"
            onClick={handleDismissNotice}
            className="text-xs text-hint hover:text-foreground"
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {error !== null ? <p className="text-xs text-destructive">{error}</p> : null}
      <OrganizationCard
        organizations={data.organizations}
        activeOrganizationId={data.activeOrganizationId}
        onChanged={handleReload}
      />
      <ConnectionsCard
        connections={data.connections}
        organizationMissing={data.organizationMissing}
      />
      <SettingsCard
        settings={data.settings}
        organizationMissing={data.organizationMissing}
        onSaved={handleReload}
      />
      <WorkItemsCard
        workItems={data.workItems}
        organizationMissing={data.organizationMissing}
      />
    </div>
  )
}
