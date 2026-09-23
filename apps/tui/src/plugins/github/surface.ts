import { useMemo, useSyncExternalStore } from 'react'

import type { LinkedPullRequest } from '@dltech/atlas-core'
import type {
  PluginProjection,
  PullRequestService,
  RepositoryCheckout,
  SessionFacts,
  UrlOpener,
} from '@dltech/atlas-harness'

import { EFooterItemReach, type FooterItem } from '../../ui/footer-item'
import type { ContributedSurface, PluginSurface } from '../surface'
import { pullRequestChip, pullRequestFallbackChip } from './pull-request-pill'
import { usePullRequest, type FooterPullRequest } from './use-pull-request'

export function pullRequestItem(args: {
  footer: FooterPullRequest | null
  onOpen: (url: string) => void
}): FooterItem | null {
  const { footer } = args
  if (footer === null) return null

  const chip =
    footer.badge === null
      ? pullRequestFallbackChip({ label: footer.label })
      : pullRequestChip(footer.badge)

  const first = chip.spans[0]
  const spans =
    footer.overflow === 0 || first === undefined
      ? chip.spans
      : [{ ...first, text: `${first.text} +${footer.overflow}` }, ...chip.spans.slice(1)]

  return {
    id: 'pr',
    spans,
    ground: chip.ground,
    reach: EFooterItemReach.Keyboard,
    onActivate: () => args.onOpen(footer.url),
  }
}

export const pullRequestSurface = (args: {
  service: PullRequestService
  facts: SessionFacts
  links: PluginProjection<readonly LinkedPullRequest[]>
  cloudCheckout: PluginProjection<RepositoryCheckout | null>
  openUrl: UrlOpener
}): ContributedSurface => {
  const { service, facts, links, cloudCheckout, openUrl } = args

  return {
    pluginId: 'github',
    use: (): PluginSurface => {
      useSyncExternalStore(facts.subscribe, facts.version)
      useSyncExternalStore(links.subscribe, links.version)
      useSyncExternalStore(cloudCheckout.subscribe, cloudCheckout.version)

      const linked = links.current()
      const { footer, section } = usePullRequest({
        service,
        projectDirectory: facts.directory(),
        working: facts.working(),
        linked,
        cloud: cloudCheckout.current(),
        onOpen: openUrl,
      })

      const footerItem = useMemo(() => pullRequestItem({ footer, onOpen: openUrl }), [footer, openUrl])

      return useMemo(() => ({ footerItem, sidebarSection: section }), [footerItem, section])
    },
  }
}
