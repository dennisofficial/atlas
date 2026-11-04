const MESSAGE_NEEDLES = ['without a finish reason']

export const droppedByMessageHeuristic = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false
  const lowered = error.message.toLowerCase()
  return MESSAGE_NEEDLES.some((needle) => lowered.includes(needle))
}
