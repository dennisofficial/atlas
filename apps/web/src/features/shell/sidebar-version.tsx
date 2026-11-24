import type { ReactNode } from 'react'

import { SidebarSeparator } from '@dltech/atlas-ui/components/sidebar'
import { Skeleton } from '@dltech/atlas-ui/components/skeleton'

import { useExpectedVersionLines, useVersionLines } from '@/features/desktop/use-version-line'

function VersionBlock({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 group-data-[collapsible=icon]:hidden">
      <SidebarSeparator className="mx-0" />
      <div
        data-testid={testId}
        className="flex flex-col gap-0.5 px-2 pb-0.5 text-xs leading-4 text-muted-foreground tabular-nums select-text"
      >
        {children}
      </div>
    </div>
  )
}

export function SidebarVersionLines({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null
  return (
    <VersionBlock testId="sidebar-version">
      {lines.map((line) => (
        <span key={line} className="break-words">
          {line}
        </span>
      ))}
    </VersionBlock>
  )
}

export function SidebarVersionSkeletonLines({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null
  return (
    <VersionBlock testId="sidebar-version-skeleton">
      {lines.map((line) => (
        <div key={line} className="flex h-4 items-center">
          <Skeleton className="h-3 max-w-full" style={{ width: `${line.length * 0.5}em` }} />
        </div>
      ))}
    </VersionBlock>
  )
}

export function SidebarVersion() {
  return <SidebarVersionLines lines={useVersionLines()} />
}

export function SidebarVersionSkeleton() {
  return <SidebarVersionSkeletonLines lines={useExpectedVersionLines()} />
}
