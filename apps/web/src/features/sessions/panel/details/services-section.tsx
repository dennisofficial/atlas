'use client'

import { ArrowUpRightIcon } from 'lucide-react'

import { useSessionPaneValue } from '../pane-value'
import { Dot, FoldedRows, Row, SectionHead } from './rows'

export function SessionServicesSection() {
  const { view, openBrowser } = useSessionPaneValue()
  if (view.previews.length === 0) return null
  return (
    <section data-session-services aria-label="Services" className="flex flex-col">
      <SectionHead title="Services" count={view.previews.length} />
      <FoldedRows
        rows={view.previews}
        render={(preview) => (
          <Row
            key={preview.serviceId}
            leading={<Dot className="bg-success" />}
            title={
              <span className="flex items-baseline gap-1">
                {preview.label}
                <span className="font-mono text-[11px] text-muted-foreground">:{preview.port}</span>
              </span>
            }
            trailing={
              <button
                type="button"
                aria-label={`Open ${preview.label}`}
                title={preview.url}
                onClick={() => openBrowser(preview.url)}
                className="flex items-center gap-0.5 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                open
                <ArrowUpRightIcon aria-hidden className="size-3" />
              </button>
            }
          />
        )}
      />
    </section>
  )
}
