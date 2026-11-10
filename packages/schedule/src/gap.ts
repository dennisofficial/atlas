import type { Cron } from './cron'

const MINUTES_PER_HOUR = 60

export const minimumGapMinutes = (cron: Cron): number => {
  const minutes = [...cron.minutes].sort((left, right) => left - right)
  let smallest = MINUTES_PER_HOUR
  for (let index = 0; index < minutes.length; index += 1) {
    const current = minutes[index] ?? 0
    const previous =
      index === 0
        ? (minutes[minutes.length - 1] ?? 0) - MINUTES_PER_HOUR
        : (minutes[index - 1] ?? 0)
    smallest = Math.min(smallest, current - previous)
  }
  return smallest
}
