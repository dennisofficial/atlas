import { currentUrlOf } from './browser-model'
import { ExternalPage, NewTabPage, PortOffline, StorybookPage } from './other-pages'
import type { PageProps } from './page-props'
import { EPageKind, EPortStatus, ESiteKind, pageOf } from './preview-sites'
import { WebAppPage } from './web-app-page'

export function TabPage(props: PageProps) {
  const url = currentUrlOf(props.tab)
  const page = pageOf(url)
  if (page.kind === EPageKind.NewTab) return <NewTabPage {...props} />
  if (page.kind === EPageKind.External) {
    return <ExternalPage {...props} siteHost={page.host} url={page.url} />
  }
  const { site, path } = page
  if (site.status !== EPortStatus.Live) return <PortOffline site={site} />
  if (site.kind === ESiteKind.Storybook) return <StorybookPage {...props} site={site} path={path} />
  return <WebAppPage {...props} site={site} path={path} />
}
