import type { KeyEvent } from '@opentui/core'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { atlasDirectory, claimReleaseNotesLaunch } from '@dltech/atlas-harness'

import { EBuildKind, buildInfo, type BuildInfo } from '../build/info'
import { fetchReleaseNotes } from '../build/release-notes'
import type { WhatsNewState } from '../ui/components/whats-new'
import { RELEASE_TAG_PREFIX } from './update-check'

export type WhatsNewView = {
  readonly from: string | null
  readonly to: string
  readonly state: WhatsNewState
}

export type WhatsNewControl = {
  readonly view: WhatsNewView | null
  readonly releasesUrl: string
  readonly handleKey: (key: KeyEvent) => void
  readonly handleClose: () => void
}

export type WhatsNewDeps = {
  readonly build: () => BuildInfo
  readonly home: () => string
  readonly claim: typeof claimReleaseNotesLaunch
  readonly fetchNotes: typeof fetchReleaseNotes
}

export const LIVE_WHATS_NEW_DEPS: WhatsNewDeps = {
  build: buildInfo,
  home: atlasDirectory,
  claim: claimReleaseNotesLaunch,
  fetchNotes: fetchReleaseNotes,
}

const releasesUrlOf = (build: BuildInfo): string =>
  build.kind === EBuildKind.Release && build.releaseRepo !== null
    ? `https://github.com/${build.releaseRepo}/releases`
    : ''

export function useWhatsNew({ deps }: { deps: WhatsNewDeps }): WhatsNewControl {
  const [view, setView] = useState<WhatsNewView | null>(null)
  const releasesUrl = useMemo(() => releasesUrlOf(deps.build()), [deps])

  useEffect(() => {
    const build = deps.build()
    if (build.kind !== EBuildKind.Release || build.releaseRepo === null) return
    const repo = build.releaseRepo

    let cancelled = false

    const open = async (): Promise<void> => {
      const decision = await deps.claim({ home: deps.home(), version: build.version })
      if (decision.kind !== 'changed' || cancelled) return

      const { from, to } = decision
      setView({ from, to, state: { kind: 'loading' } })

      const outcome = await deps.fetchNotes({
        repo,
        prefix: RELEASE_TAG_PREFIX,
        sinceVersion: from,
        upToVersion: to,
      })
      if (cancelled) return

      const state: WhatsNewState = outcome.kind === 'ok' ? { kind: 'ready', rows: outcome.rows } : { kind: 'failed' }
      setView((current) => (current === null || current.to !== to ? current : { from, to, state }))
    }
    void open()

    return () => {
      cancelled = true
    }
  }, [deps])

  const handleClose = useCallback(() => setView(null), [])

  const handleKey = useCallback(
    (key: KeyEvent) => {
      if (view === null) return
      if (key.name === 'escape') {
        key.preventDefault()
        handleClose()
      }
    },
    [view, handleClose],
  )

  return useMemo(
    () => ({ view, releasesUrl, handleKey, handleClose }),
    [view, releasesUrl, handleKey, handleClose],
  )
}
