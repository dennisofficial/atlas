import type { KeyEvent } from '@opentui/core'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { decideReleaseNotes, type ReleaseNotesRow } from '@dltech/atlas-core'
import { atlasDirectory } from '@dltech/atlas-harness'

import { EBuildKind, buildInfo } from '../build/info'
import { lastLaunchedPathFor, readLastLaunched, writeLastLaunched } from '../build/last-launched'
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

const fetchWithFallback = async (args: {
  repo: string
  prefix: string
  sinceVersion: string
  upToVersion: string
}): Promise<readonly ReleaseNotesRow[] | null> => {
  const outcome = await fetchReleaseNotes(args)
  return outcome.kind === 'ok' ? outcome.rows : null
}

/**
 * First launch of a release build compares the persisted last-launched version against the
 * binary's own; anything newer opens the notes modal. The file is rewritten to the current
 * version the moment the range is computed — before the fetch — so a crash never replays the
 * modal, and a second tile at the same version sees an empty diff. First-ever run records the
 * version silently rather than dumping every note ever published.
 */
export function useWhatsNew(): WhatsNewControl {
  const [view, setView] = useState<WhatsNewView | null>(null)
  const [releasesUrl, setReleasesUrl] = useState('')

  useEffect(() => {
    const build = buildInfo()
    if (build.kind !== EBuildKind.Release || build.releaseRepo === null) return
    const repo: string = build.releaseRepo
    setReleasesUrl(`https://github.com/${repo}/releases`)

    let cancelled = false
    const path = lastLaunchedPathFor(atlasDirectory())

    const open = async (): Promise<void> => {
      const lastLaunched = await readLastLaunched(path)
      const decision = decideReleaseNotes({ lastLaunched, current: build.version })

      await writeLastLaunched({ path, version: build.version })
      if (decision.kind !== 'changed' || cancelled) return

      const from = decision.from
      setView({ from, to: decision.to, state: { kind: 'loading' } })

      const rows = await fetchWithFallback({
        repo,
        prefix: RELEASE_TAG_PREFIX,
        sinceVersion: from,
        upToVersion: decision.to,
      })
      if (cancelled) return
      setView({
        from,
        to: decision.to,
        state: rows === null ? { kind: 'failed' } : { kind: 'ready', rows },
      })
    }
    void open()

    return () => {
      cancelled = true
    }
  }, [])

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
