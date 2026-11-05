import { ExternalLinkIcon, GlobeIcon, ServerOffIcon } from 'lucide-react'

import { Notice } from '@dltech/atlas-ui/ai/notice'
import { Button } from '@dltech/atlas-ui/components/button'
import { Input } from '@dltech/atlas-ui/components/input'
import { Spinner } from '@dltech/atlas-ui/components/spinner'

import { SiteDot } from './browser-tab-strip'
import { EBrowserHost } from './browser-host'
import { fieldOf } from './browser-model'
import type { PageProps } from './page-props'
import {
  EPortStatus,
  PORT_STATUS_LABEL,
  PREVIEW_SITES,
  siteUrl,
  type PreviewSite,
} from './preview-sites'

export function NewTabPage({ onNavigate }: PageProps) {
  return (
    <div className="flex h-full flex-col items-center overflow-auto p-6">
      <div className="flex w-full max-w-md flex-col gap-3 pt-8">
        <p className="text-sm font-medium">Open a port</p>
        <ul className="flex flex-col overflow-hidden rounded-lg border">
          {PREVIEW_SITES.map((site) => (
            <li key={site.port} className="border-b last:border-b-0">
              <button
                type="button"
                onClick={() => onNavigate(siteUrl({ site }))}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
              >
                <SiteDot status={site.status} />
                <span className="flex-1">{site.label}</span>
                <span className="text-xs text-muted-foreground">
                  {PORT_STATUS_LABEL[site.status]}
                </span>
                <span className="w-12 text-right font-mono text-xs text-muted-foreground tabular-nums">
                  :{site.port}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Or type a port (<span className="font-mono">3000</span>), a path (
          <span className="font-mono">/dashboard</span>) or a URL in the address bar.
        </p>
      </div>
    </div>
  )
}

export function PortOffline({ site }: { site: PreviewSite }) {
  const starting = site.status === EPortStatus.Starting
  return (
    <Notice
      icon={starting ? <Spinner /> : <ServerOffIcon />}
      title={
        starting ? `Waiting for port ${site.port}` : `Nothing is listening on port ${site.port}`
      }
      description={
        starting
          ? 'The dev server is still booting. This tab loads on its own when it is up.'
          : 'The tab keeps its address and reloads when the server is back.'
      }
    />
  )
}

const STORIES = ['button', 'card', 'dialog', 'input']

export function StorybookPage({
  site,
  path,
  onNavigate,
}: PageProps & { site: PreviewSite; path: string }) {
  const story = /story\/([\w-]+)/.exec(path)?.[1] ?? 'button'
  return (
    <div className="light flex h-full bg-background text-foreground">
      <nav className="flex w-36 shrink-0 flex-col gap-0.5 border-r p-2 text-sm">
        {STORIES.map((name) => (
          <Button
            key={name}
            variant="ghost"
            size="sm"
            aria-current={name === story ? 'page' : undefined}
            onClick={() => onNavigate(siteUrl({ site, path: `/?path=/story/${name}` }))}
            className="justify-start capitalize"
          >
            {name}
          </Button>
        ))}
      </nav>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="rounded-lg border border-dashed p-8 text-sm capitalize">{story} story</div>
      </div>
    </div>
  )
}

function ExternalBlocked({ url }: { url: string }) {
  return (
    <Notice
      icon={<GlobeIcon />}
      title="This site can't open in the web preview"
      description="The web preview only loads your sandbox's byatlas.dev ports. Open it in your browser, or use the Mac app, which loads any site."
      action={
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<a href={url} target="_blank" rel="noreferrer noopener" />}
        >
          <ExternalLinkIcon data-icon="inline-start" />
          Open in your browser
        </Button>
      }
    />
  )
}

function ExternalNative(props: PageProps & { siteHost: string }) {
  const { tab, onField, siteHost } = props
  return (
    <div className="light flex h-full flex-col items-center justify-center gap-4 bg-background p-6 text-foreground">
      <p className="font-display text-xl font-semibold">Sign in to {siteHost}</p>
      <div className="flex w-full max-w-xs flex-col gap-2">
        <Input
          aria-label="Username"
          placeholder="Username"
          value={fieldOf({ tab, name: 'username' })}
          onChange={(event) => onField({ name: 'username', value: event.target.value })}
        />
        <Button>Continue</Button>
      </div>
      <p className="max-w-xs text-center text-xs text-muted-foreground">
        The Mac app loads any site natively, so OAuth redirects finish inside the tab.
      </p>
    </div>
  )
}

export function ExternalPage(props: PageProps & { siteHost: string; url: string }) {
  if (props.runtime === EBrowserHost.Mac) return <ExternalNative {...props} />
  return <ExternalBlocked url={props.url} />
}
