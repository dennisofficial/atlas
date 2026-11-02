import { Skeleton } from '@dltech/atlas-ui/components/skeleton'

const CHANGE_ROWS = [
  { name: 'w-28', dir: 'w-32' },
  { name: 'w-20', dir: 'w-40' },
  { name: 'w-32', dir: 'w-24' },
  { name: 'w-24', dir: 'w-36' },
  { name: 'w-36', dir: 'w-28' },
  { name: 'w-20', dir: 'w-32' },
  { name: 'w-28', dir: 'w-40' },
  { name: 'w-32', dir: 'w-24' },
]

const FILE_ROWS = [
  { folder: true, name: 'w-20' },
  { folder: true, name: 'w-28' },
  { folder: true, name: 'w-16' },
  { folder: true, name: 'w-24' },
  { folder: false, name: 'w-32' },
  { folder: false, name: 'w-24' },
  { folder: false, name: 'w-28' },
  { folder: false, name: 'w-36' },
  { folder: false, name: 'w-20' },
  { folder: false, name: 'w-28' },
]

export function ChangesLoading() {
  return (
    <div
      role="status"
      aria-label="Loading changes"
      className="flex h-full min-h-0 w-full min-w-0 flex-col bg-card"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-3 w-12" />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Skeleton className="h-7 w-[4.25rem]" />
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-7 w-[4.5rem]" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <ul className="flex flex-col py-1">
          {CHANGE_ROWS.map((row, index) => (
            <li key={index} className="flex h-8 w-full min-w-0 items-center gap-2 px-3">
              <Skeleton className="size-3.5 shrink-0" />
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <Skeleton className={`h-4 shrink-0 ${row.name}`} />
                <Skeleton className={`h-3 min-w-0 ${row.dir}`} />
              </span>
              <Skeleton className="h-3 w-14 shrink-0" />
              <Skeleton className="h-3 w-3 shrink-0" />
            </li>
          ))}
        </ul>
      </div>
      <div className="shrink-0 border-t border-border p-1.5">
        <Skeleton className="h-7 w-full" />
      </div>
    </div>
  )
}

export function FilesLoading() {
  return (
    <div role="status" aria-label="Loading files" className="h-full overflow-hidden p-2">
      <div className="flex flex-col">
        {FILE_ROWS.map((row, index) => (
          <div key={index} className="flex h-7 w-full items-center gap-1 px-2.5">
            {row.folder ? <Skeleton className="size-3.5 shrink-0" /> : null}
            <Skeleton className="size-3.5 shrink-0" />
            <Skeleton className={`h-3.5 ${row.name}`} />
          </div>
        ))}
      </div>
    </div>
  )
}
