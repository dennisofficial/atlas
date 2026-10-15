import { useEffect, useMemo } from 'react'

import { clearNotice, ENoticeTone, notify, NOTICE_WARN_MS } from '../../ui/notice-store'

export type AppInstallRecommendation = { installUrl: string; repoFullName: string }

export type AppInstallRecommendationSource = {
  subscribe: (listener: (recommendation: AppInstallRecommendation) => void) => () => void
}

export type AppInstallNoticer = {
  raise: (args: { repo: string; installUrl: string }) => void
  dismiss: (args: { repo: string }) => void
}

export const appInstallNoticeKey = (repo: string): string => `github-app-install:${repo}`

export const appInstallNoticeText = (args: { repo: string; installUrl: string }): string =>
  `PR events on ${args.repo} are polled (degraded) — install the Atlas GitHub App (any org admin) for realtime reviews and comments: ${args.installUrl}`

export function createAppInstallNoticer(
  args: { recordDismissal?: (args: { repo: string }) => void } = {},
): AppInstallNoticer {
  const settled = new Set<string>()

  return {
    raise: ({ repo, installUrl }) => {
      if (settled.has(repo)) return
      settled.add(repo)
      notify({
        key: appInstallNoticeKey(repo),
        text: appInstallNoticeText({ repo, installUrl }),
        tone: ENoticeTone.Info,
        ttlMs: NOTICE_WARN_MS,
      })
    },
    dismiss: ({ repo }) => {
      settled.add(repo)
      clearNotice({ key: appInstallNoticeKey(repo) })
      args.recordDismissal?.({ repo })
    },
  }
}

/**
 * The recommendation carries its repo, so the notice attributes to the repo that is actually
 * poll-backed — which need not be the checkout the conversation is standing on (a linked pull
 * request in another repo recommends the app for that repo).
 */
export function useAppInstallNotice(args: {
  source: AppInstallRecommendationSource | null
  recordDismissal?: (args: { repo: string }) => void
}): AppInstallNoticer {
  const { source, recordDismissal } = args
  const noticer = useMemo(
    () => createAppInstallNoticer(recordDismissal === undefined ? {} : { recordDismissal }),
    [recordDismissal],
  )

  useEffect(() => {
    if (source === null) return
    return source.subscribe(({ installUrl, repoFullName }) =>
      noticer.raise({ repo: repoFullName, installUrl }),
    )
  }, [source, noticer])

  return noticer
}
