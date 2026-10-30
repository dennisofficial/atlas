import { SidebarSeparator } from '@dltech/atlas-ui/components/sidebar'

import { useVersionLines } from '@/features/desktop/use-version-line'

export function SidebarVersionLines({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null
  return (
    <div className="flex flex-col gap-2 group-data-[collapsible=icon]:hidden">
      <SidebarSeparator className="mx-0" />
      <div
        data-testid="sidebar-version"
        className="flex flex-col gap-0.5 px-2 pb-0.5 text-xs leading-4 text-muted-foreground tabular-nums select-text"
      >
        {lines.map((line) => (
          <span key={line} className="break-words">
            {line}
          </span>
        ))}
      </div>
    </div>
  )
}

export function SidebarVersion() {
  return <SidebarVersionLines lines={useVersionLines()} />
}
