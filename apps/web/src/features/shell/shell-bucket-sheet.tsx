'use client'

import Link from 'next/link'

import { Button } from '@dltech/atlas-ui/components/button'
import { Input } from '@dltech/atlas-ui/components/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@dltech/atlas-ui/components/sheet'
import { ESessionBucket } from '@dltech/atlas-wire/web'

import { relativeTime } from '@/features/settings/data/personal/relative-time'
import { UNTITLED } from '@/features/threads/data/untitled'

import type { PageBucket, SheetRow } from './session-pager'
import { useClock } from './use-clock'
import { useSessionPager } from './use-session-pager'

const TITLES: Record<PageBucket, string> = {
  [ESessionBucket.Inactive]: 'Inactive',
  [ESessionBucket.Archived]: 'Archived',
}

const PLACEHOLDERS: Record<PageBucket, string> = {
  [ESessionBucket.Inactive]: 'Search inactive sessions',
  [ESessionBucket.Archived]: 'Search archived sessions',
}

function PageRow({ row, now }: { row: SheetRow; now: number }) {
  return (
    <li>
      <Link
        href={row.href}
        className="flex flex-col gap-0.5 rounded-md px-2 py-1.5 hover:bg-sidebar-accent"
      >
        <span className="truncate text-sm text-foreground">{row.title ?? UNTITLED}</span>
        <span className="text-xs text-muted-foreground">
          {relativeTime({ from: row.updatedAt, now })}
        </span>
      </Link>
    </li>
  )
}

export interface BucketSheetProps {
  bucket: PageBucket
  onOpenChange: (open: boolean) => void
}

export function BucketSheet({ bucket, onOpenChange }: BucketSheetProps) {
  const { snapshot, term, setTerm, loadMore } = useSessionPager(bucket)
  const now = useClock()
  const count = snapshot.total ?? snapshot.rows.length

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent side="right" className="data-[side=right]:sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{TITLES[bucket]}</SheetTitle>
          <SheetDescription>
            {snapshot.loading && snapshot.rows.length === 0
              ? 'Loading sessions'
              : `${count} ${count === 1 ? 'session' : 'sessions'}`}
          </SheetDescription>
        </SheetHeader>
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={PLACEHOLDERS[bucket]}
          aria-label={PLACEHOLDERS[bucket]}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {snapshot.error !== null && (
            <p className="px-2 text-sm text-destructive">{snapshot.error}</p>
          )}
          {snapshot.error === null && snapshot.rows.length === 0 && !snapshot.loading && (
            <p className="px-2 text-sm text-muted-foreground">
              No sessions match{' '}
              {snapshot.search.length === 0 ? 'this bucket' : `“${snapshot.search}”`}.
            </p>
          )}
          <ul className="flex flex-col gap-0.5">
            {snapshot.rows.map((row) => (
              <PageRow key={row.id} row={row} now={now} />
            ))}
          </ul>
          {snapshot.next && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 w-full"
              disabled={snapshot.loading}
              onClick={loadMore}
            >
              {snapshot.loading ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
