import { ServerOffIcon } from 'lucide-react'

import { Spinner } from '#components/spinner'
import { Notice } from './notice'
import { PreviewStatusDot } from './internal/preview-status-dot'
import { EPreviewStatus, PREVIEW_STATUS_LABEL, type PreviewPort } from './preview-ports'

export interface PreviewNewTabProps {
  ports: PreviewPort[]
  onOpen: (port: PreviewPort) => void
}

export function PreviewNewTab({ ports, onOpen }: PreviewNewTabProps) {
  return (
    <div className="flex h-full flex-col items-center overflow-auto p-6">
      <div className="flex w-full max-w-md flex-col gap-3 pt-8">
        <p className="text-sm font-medium">Open a port</p>
        {ports.length === 0 ? (
          <p className="text-sm text-muted-foreground">No ports are exposed yet.</p>
        ) : (
          <ul className="flex flex-col overflow-hidden rounded-lg border">
            {ports.map((port) => (
              <li key={port.id} className="border-b last:border-b-0">
                <button
                  type="button"
                  onClick={() => onOpen(port)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
                >
                  <PreviewStatusDot status={port.status} />
                  <span className="flex-1">{port.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {PREVIEW_STATUS_LABEL[port.status]}
                  </span>
                  <span className="w-12 text-right font-mono text-xs text-muted-foreground tabular-nums">
                    :{port.port}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Or type a port (<span className="font-mono">3000</span>), a path (
          <span className="font-mono">/dashboard</span>) or a URL in the address bar.
        </p>
      </div>
    </div>
  )
}

export function PreviewOffline({ port }: { port: PreviewPort }) {
  const starting = port.status === EPreviewStatus.Starting
  return (
    <Notice
      icon={starting ? <Spinner /> : <ServerOffIcon />}
      title={
        starting ? `Waiting for port ${port.port}` : `Nothing is listening on port ${port.port}`
      }
      description={
        starting
          ? 'The dev server is still booting. This tab loads on its own when it is up.'
          : 'The tab keeps its address and reloads when the server is back.'
      }
    />
  )
}
