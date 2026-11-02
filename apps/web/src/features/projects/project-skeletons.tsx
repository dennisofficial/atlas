import { Skeleton } from '@dltech/atlas-ui/components/skeleton'

const ROW_KEYS = [0, 1, 2]
const TILE_KEYS = [0, 1, 2, 3]

export const PROJECT_LIST_CLASS =
  'divide-y divide-border overflow-hidden rounded-xl border border-border'

export function ProjectListSkeleton() {
  return (
    <ul className={PROJECT_LIST_CLASS}>
      {ROW_KEYS.map((key) => (
        <li key={key} className="flex items-center gap-2 pr-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-4 py-3">
            <div className="flex h-5 items-center">
              <Skeleton className="h-4 w-40" />
            </div>
            <div className="flex h-4 items-center">
              <Skeleton className="h-3 w-56 max-w-full" />
            </div>
          </div>
          <Skeleton className="size-8 rounded-lg" />
        </li>
      ))}
    </ul>
  )
}

export function RepositoryStepSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex h-4 items-center">
          <Skeleton className="h-3 w-32" />
        </div>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {TILE_KEYS.map((key) => (
            <li
              key={key}
              className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2.5"
            >
              <div className="flex h-5 items-center gap-1.5">
                <Skeleton className="size-3.5 shrink-0" />
                <Skeleton className="h-3 w-40 max-w-full" />
              </div>
              <div className="flex h-4 items-center">
                <Skeleton className="h-3 w-24" />
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-8 w-full rounded-lg" />
      </div>
    </div>
  )
}

export function NewThreadSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-input p-2">
      <Skeleton className="h-16 w-full" />
      <div className="flex items-center gap-1">
        <Skeleton className="size-7 rounded-full" />
        <Skeleton className="h-7 w-32 rounded-lg" />
        <Skeleton className="ml-auto h-7 w-32 rounded-lg" />
        <Skeleton className="size-7 rounded-full" />
      </div>
    </div>
  )
}
