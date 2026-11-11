import { Skeleton } from '@dltech/atlas-ui/components/skeleton'

const ROW_KEYS = [0, 1, 2]

export const ARTIFACT_LIST_CLASS =
  'divide-y divide-border overflow-hidden rounded-xl border border-border'

export function ArtifactListSkeleton() {
  return (
    <ul className={ARTIFACT_LIST_CLASS}>
      {ROW_KEYS.map((key) => (
        <li key={key} className="flex items-center gap-2 pr-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-4 py-3">
            <div className="flex h-5 items-center">
              <Skeleton className="h-4 w-36" />
            </div>
            <div className="flex h-4 items-center gap-1.5">
              <Skeleton className="h-3 w-48 max-w-full" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
          <Skeleton className="size-7 rounded-lg" />
        </li>
      ))}
    </ul>
  )
}

export function ArtifactDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6" role="presentation">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      {ROW_KEYS.map((key) => (
        <div key={key} className="flex flex-col gap-2 rounded-xl border border-border px-4 py-3">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  )
}
