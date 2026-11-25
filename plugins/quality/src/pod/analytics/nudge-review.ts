const nudged = new Map<string, string>()

const keyOf = ({ sessionId, findingId }: { sessionId: string; findingId: string }): string =>
  `${sessionId}\u0000${findingId}`

export const rememberNudgedFindings = (args: {
  sessionId: string
  reviewId: string
  findingIds: readonly string[]
}): void => {
  for (const findingId of args.findingIds)
    nudged.set(keyOf({ sessionId: args.sessionId, findingId }), args.reviewId)
}

export const forgetNudgedFindings = (): void => {
  nudged.clear()
}

export const nudgingReviewIdsOf = ({
  sessionId,
}: {
  sessionId: string
}): ReadonlyMap<string, string> => {
  const prefix = `${sessionId}\u0000`
  return new Map(
    [...nudged.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, reviewId]) => [key.slice(prefix.length), reviewId]),
  )
}
