import { NEW_TAB_URL } from './browser-model'

export enum EPortStatus {
  Live = 'live',
  Starting = 'starting',
  Stopped = 'stopped',
}

export enum ESiteKind {
  WebApp = 'web-app',
  Storybook = 'storybook',
  Api = 'api',
}

export enum EPageKind {
  NewTab = 'new-tab',
  Site = 'site',
  External = 'external',
}

export type PreviewSite = {
  port: number
  label: string
  host: string
  status: EPortStatus
  kind: ESiteKind
}

export type PreviewPage =
  | { kind: EPageKind.NewTab }
  | { kind: EPageKind.Site; site: PreviewSite; path: string }
  | { kind: EPageKind.External; host: string; url: string }

const TUNNEL = 'k2x9q4m1a7.byatlas.dev'

const siteOf = (args: Omit<PreviewSite, 'host'>): PreviewSite => ({
  ...args,
  host: `${args.port}-${TUNNEL}`,
})

export const PREVIEW_SITES: PreviewSite[] = [
  siteOf({ port: 3000, label: 'Web app', status: EPortStatus.Live, kind: ESiteKind.WebApp }),
  siteOf({ port: 4000, label: 'API', status: EPortStatus.Stopped, kind: ESiteKind.Api }),
  siteOf({ port: 6006, label: 'Storybook', status: EPortStatus.Live, kind: ESiteKind.Storybook }),
  siteOf({ port: 8081, label: 'Docs', status: EPortStatus.Starting, kind: ESiteKind.WebApp }),
]

export const PORT_STATUS_LABEL: Record<EPortStatus, string> = {
  [EPortStatus.Live]: 'Live',
  [EPortStatus.Starting]: 'Starting',
  [EPortStatus.Stopped]: 'Stopped',
}

export const WEB_ROUTE_TITLES: Record<string, string> = {
  '/': 'Acme',
  '/pricing': 'Pricing',
  '/dashboard': 'Dashboard',
  '/settings': 'Settings',
}

export const siteByPort = (port: number): PreviewSite | undefined =>
  PREVIEW_SITES.find((site) => site.port === port)

export const siteUrl = (args: { site: PreviewSite; path?: string }): string =>
  `https://${args.site.host}${args.path ?? '/'}`

export const pathnameOf = (path: string): string => path.split('?')[0] ?? '/'

const parseUrl = (value: string): URL | null => {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

export function pageOf(url: string): PreviewPage {
  if (url === NEW_TAB_URL) return { kind: EPageKind.NewTab }
  const parsed = parseUrl(url)
  if (parsed === null) return { kind: EPageKind.NewTab }
  const site = PREVIEW_SITES.find((candidate) => candidate.host === parsed.host)
  if (site) return { kind: EPageKind.Site, site, path: `${parsed.pathname}${parsed.search}` }
  return { kind: EPageKind.External, host: parsed.host, url }
}

const PORT_ONLY = /^:?(\d{2,5})(\/\S*)?$/
const LOCALHOST = /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})(\/\S*)?$/
const HAS_SCHEME = /^[a-z][a-z\d+.-]*:\/\//i

export function resolveAddress(args: { input: string; currentUrl: string }): string | null {
  const text = args.input.trim()
  if (text === '' || /\s/.test(text)) return null
  if (text.startsWith('/')) {
    const current = pageOf(args.currentUrl)
    const base =
      current.kind === EPageKind.Site
        ? current.site
        : PREVIEW_SITES.find((site) => site.status === EPortStatus.Live)
    return base ? siteUrl({ site: base, path: text }) : null
  }
  const local = PORT_ONLY.exec(text) ?? LOCALHOST.exec(text)
  if (local) {
    const port = Number(local[1])
    const path = local[2] ?? '/'
    const site = siteByPort(port)
    return site ? siteUrl({ site, path }) : `http://localhost:${port}${path}`
  }
  return parseUrl(HAS_SCHEME.test(text) ? text : `https://${text}`)?.toString() ?? null
}

export function titleOf(url: string): string {
  const page = pageOf(url)
  if (page.kind === EPageKind.NewTab) return 'New tab'
  if (page.kind === EPageKind.External) return page.host
  const { site, path } = page
  if (site.status !== EPortStatus.Live) return `${site.label} :${site.port}`
  if (site.kind === ESiteKind.WebApp) return WEB_ROUTE_TITLES[pathnameOf(path)] ?? '404'
  return site.label
}

export const displayUrlOf = (url: string): string => (url === NEW_TAB_URL ? '' : url)
