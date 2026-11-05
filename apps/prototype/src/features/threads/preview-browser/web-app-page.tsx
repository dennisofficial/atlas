import type { ReactNode } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Input } from '@dltech/atlas-ui/components/input'
import { Textarea } from '@dltech/atlas-ui/components/textarea'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { currentUrlOf, fieldOf } from './browser-model'
import type { PageProps } from './page-props'
import { pathnameOf, siteUrl, WEB_ROUTE_TITLES, type PreviewSite } from './preview-sites'
import { useRememberedScroll } from './scroll-memory'

type SiteProps = PageProps & { site: PreviewSite; path: string }

const NAV = ['/', '/pricing', '/dashboard', '/settings']
const PLANS = [
  { name: 'Starter', price: '$0' },
  { name: 'Team', price: '$24' },
  { name: 'Scale', price: '$96' },
]
const ORDERS = Array.from({ length: 40 }, (_, at) => ({
  id: `#${(4810 + at).toString()}`,
  customer: ['Nadia Kerr', 'Omar Haddad', 'Lena Vogt', 'Ravi Patel'][at % 4] ?? '',
  total: `$${(((at * 37) % 400) + 20).toFixed(2)}`,
}))

function Hero({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="flex flex-col items-start gap-4 px-6 py-16 @2xl:py-24">
      <h1 className="font-display text-3xl font-semibold tracking-tight @2xl:text-5xl">
        Ship invoices before lunch.
      </h1>
      <p className="max-w-md text-muted-foreground">
        Acme turns your orders into paid invoices. This is the app the agent is building.
      </p>
      <Button onClick={onOpen}>Open dashboard</Button>
    </section>
  )
}

function Pricing() {
  return (
    <section className="grid gap-3 p-6 @2xl:grid-cols-3">
      {PLANS.map((plan) => (
        <div key={plan.name} className="flex flex-col gap-1 rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">{plan.name}</p>
          <p className="text-2xl font-semibold">{plan.price}</p>
        </div>
      ))}
    </section>
  )
}

function Dashboard() {
  return (
    <section className="flex flex-col gap-3 p-6">
      <p className="text-sm text-muted-foreground">
        Scroll down, switch sessions, come back: the scroll position stays.
      </p>
      {ORDERS.map((order) => (
        <div
          key={order.id}
          className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
        >
          <span className="font-mono">{order.id}</span>
          <span className="flex-1 px-3">{order.customer}</span>
          <span className="tabular-nums">{order.total}</span>
        </div>
      ))}
    </section>
  )
}

function Settings({ tab, onField }: SiteProps) {
  return (
    <section className="flex max-w-md flex-col gap-3 p-6">
      <p className="text-sm text-muted-foreground">
        Type here, switch tabs or sessions, come back: the text is still there. Reload clears it.
      </p>
      <Input
        aria-label="Company name"
        placeholder="Company name"
        value={fieldOf({ tab, name: 'company' })}
        onChange={(event) => onField({ name: 'company', value: event.target.value })}
      />
      <Textarea
        aria-label="Invoice footer"
        placeholder="Invoice footer"
        value={fieldOf({ tab, name: 'footer' })}
        onChange={(event) => onField({ name: 'footer', value: event.target.value })}
      />
    </section>
  )
}

function NotFound() {
  return (
    <div className="flex flex-1 items-center justify-center gap-4 p-6 text-sm">
      <span className="border-r pr-4 text-2xl font-medium">404</span>
      This page could not be found.
    </div>
  )
}

function bodyOf(props: SiteProps, go: (path: string) => void): ReactNode {
  const pathname = pathnameOf(props.path)
  if (pathname === '/') return <Hero onOpen={() => go('/dashboard')} />
  if (pathname === '/pricing') return <Pricing />
  if (pathname === '/dashboard') return <Dashboard />
  if (pathname === '/settings') return <Settings {...props} />
  return <NotFound />
}

export function WebAppPage(props: SiteProps) {
  const { tab, site, path, onNavigate } = props
  const scroll = useRememberedScroll(`${tab.id}|${currentUrlOf(tab)}|${tab.reloads}`)
  const go = (next: string) => onNavigate(siteUrl({ site, path: next }))
  const active = pathnameOf(path)
  return (
    <div
      ref={scroll.ref}
      onScroll={scroll.handleScroll}
      className="light @container flex h-full flex-col overflow-auto bg-background text-foreground"
    >
      <header className="sticky top-0 flex items-center gap-1 border-b bg-background px-4 py-2">
        <span className="mr-3 font-display font-semibold">Acme</span>
        {NAV.map((href) => (
          <Button
            key={href}
            variant="ghost"
            size="sm"
            aria-current={href === active ? 'page' : undefined}
            onClick={() => go(href)}
            className={cn(href === '/' && 'hidden @md:inline-flex')}
          >
            {WEB_ROUTE_TITLES[href]}
          </Button>
        ))}
      </header>
      {bodyOf(props, go)}
    </div>
  )
}
