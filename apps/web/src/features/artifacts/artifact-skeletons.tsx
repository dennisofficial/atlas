import { Skeleton } from '@dltech/atlas-ui/components/skeleton'

const CARD_KEYS = [0, 1, 2, 3]

export const ARTIFACT_GRID_CLASS = 'grid grid-cols-1 gap-4 sm:grid-cols-2'

export function ArtifactListSkeleton() {
  return (
    <ul className={ARTIFACT_GRID_CLASS}>
      {CARD_KEYS.map((key) => (
        <li key={key} className="flex flex-col overflow-hidden rounded-xl border border-border">
          <Skeleton className="aspect-[16/10] w-full rounded-none" />
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48 max-w-full" />
          </div>
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
      <Skeleton className="aspect-[16/10] w-full rounded-xl" />
      {CARD_KEYS.slice(0, 2).map((key) => (
        <div key={key} className="flex flex-col gap-2 rounded-xl border border-border px-4 py-3">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  )
}
