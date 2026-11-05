import type { BrowserTab } from './browser-model'
import type { EBrowserHost } from './browser-host'

export type PageProps = {
  tab: BrowserTab
  runtime: EBrowserHost
  onNavigate: (url: string) => void
  onField: (args: { name: string; value: string }) => void
}
