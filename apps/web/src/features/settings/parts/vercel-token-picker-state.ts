'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import {
  EVercelPlan,
  type VercelProjectChoice,
  type VercelTeamChoice,
} from '@dltech/atlas-wire/web'

import {
  PLAN_BADGE_LABEL,
  type VercelCredentialView,
  type VercelDraft,
} from '../data/shared/vercel-credential'
import {
  IDLE_DISCOVERY,
  teamsLoaded,
  type VercelDiscoverFn,
  type VercelDiscoveryState,
} from '../data/shared/vercel-discovery'

const DISCOVERY_DEBOUNCE_MS = 400

export function planBadgeTextOf(plan: EVercelPlan): string {
  return PLAN_BADGE_LABEL[plan]
}

export function teamLabelOf(team: VercelTeamChoice): string {
  const name = team.slug === '' ? team.name : team.slug
  return `${name ?? team.id} · ${planBadgeTextOf(team.plan)}`
}

export type TokenPickerState = {
  draft: VercelDraft
  setDraft: (next: VercelDraft) => void
  discovery: VercelDiscoveryState
  replacing: boolean
  setReplacing: (next: boolean) => void
  tokenRef: React.RefObject<HTMLInputElement | null>
  teams: VercelTeamChoice[]
  projects: VercelProjectChoice[]
}

function teamIdForDiscovery(args: { teams: VercelTeamChoice[]; current: string }): {
  teamId: string
  keepProject: boolean
} {
  if (args.teams.length === 1) {
    const only = args.teams[0]
    return { teamId: only === undefined ? '' : only.id, keepProject: false }
  }
  if (args.teams.some((team) => team.id === args.current)) {
    return { teamId: args.current, keepProject: true }
  }
  return { teamId: '', keepProject: false }
}

export function useTokenPickerState(args: {
  view: VercelCredentialView
  discover: VercelDiscoverFn | undefined
}): TokenPickerState {
  const { view, discover } = args
  const tokenRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<VercelDraft>({
    teamId: view.teamId,
    vercelProjectId: view.vercelProjectId,
    token: '',
  })
  const [discovery, setDiscovery] = useState<VercelDiscoveryState>(IDLE_DISCOVERY)
  const [projectsTeamId, setProjectsTeamId] = useState<string | null>(null)
  const [replacing, setReplacing] = useState(false)

  const ready = discover !== undefined && (draft.token.trim() !== '' || view.configured)

  useEffect(() => {
    if (discover === undefined || !ready) return
    let stale = false
    setDiscovery({ status: 'loading' })
    const timer = setTimeout(() => {
      discover({ token: draft.token.trim() === '' ? undefined : draft.token.trim() })
        .then((data) => {
          if (stale) return
          setDiscovery({ status: 'loaded', data })
          setProjectsTeamId(null)
          setDraft((current) => {
            const next = teamIdForDiscovery({ teams: data.teams, current: current.teamId })
            return {
              ...current,
              teamId: next.teamId,
              vercelProjectId: next.keepProject ? current.vercelProjectId : '',
            }
          })
        })
        .catch((failure: unknown) => {
          if (stale) return
          setDiscovery({
            status: 'failed',
            message: failure instanceof Error ? failure.message : 'Vercel discovery failed',
          })
        })
    }, DISCOVERY_DEBOUNCE_MS)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [discover, ready, draft.token])

  useEffect(() => {
    if (discover === undefined || !teamsLoaded(discovery)) return
    if (draft.teamId === '' || projectsTeamId === draft.teamId) return
    let stale = false
    const teamId = draft.teamId
    discover({ token: draft.token.trim() === '' ? undefined : draft.token.trim(), teamId })
      .then((data) => {
        if (stale) return
        setProjectsTeamId(teamId)
        setDiscovery({ status: 'loaded', data })
        setDraft((current) => {
          if (data.projects.length === 1) {
            const only = data.projects[0]
            return only === undefined ? current : { ...current, vercelProjectId: only.id }
          }
          if (data.projects.some((project) => project.id === current.vercelProjectId)) {
            return current
          }
          return { ...current, vercelProjectId: '' }
        })
      })
      .catch(() => {
        if (!stale) setProjectsTeamId(teamId)
      })
    return () => {
      stale = true
    }
  }, [discover, discovery, draft.teamId, draft.token, projectsTeamId])

  const teams = discovery.status === 'loaded' ? discovery.data.teams : []
  const projects = discovery.status === 'loaded' ? discovery.data.projects : []

  return useMemo(
    () => ({
      draft,
      setDraft,
      discovery,
      replacing,
      setReplacing,
      tokenRef,
      teams,
      projects,
    }),
    [draft, discovery, replacing, teams, projects],
  )
}
