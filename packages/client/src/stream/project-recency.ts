export const RECENT_PROJECT_WINDOW_MS = 72 * 60 * 60 * 1000

const activityStampOf = (stamp: string | null | undefined): number => {
  if (stamp === null || stamp === undefined) return Number.NEGATIVE_INFINITY
  const parsed = Date.parse(stamp)
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed
}

export const lastActivityAt = ({
  createdAt,
  stamps,
}: {
  createdAt: string | null | undefined
  stamps: readonly (string | null | undefined)[]
}): number =>
  stamps.reduce(
    (latest, stamp) => Math.max(latest, activityStampOf(stamp)),
    activityStampOf(createdAt),
  )

export const isRecentProject = ({
  createdAt,
  stamps,
  now,
}: {
  createdAt: string | null | undefined
  stamps: readonly (string | null | undefined)[]
  now: number
}): boolean => now - lastActivityAt({ createdAt, stamps }) <= RECENT_PROJECT_WINDOW_MS
