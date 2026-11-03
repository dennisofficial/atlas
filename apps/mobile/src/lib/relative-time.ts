const minuteMs = 60_000
const hourMs = 60 * minuteMs
const dayMs = 24 * hourMs

export const relativeTime = ({ at, now }: { at: string; now: number }): string => {
  const elapsed = now - Date.parse(at)
  if (Number.isNaN(elapsed) || elapsed < 0) return 'just now'
  if (elapsed < minuteMs) return 'just now'
  if (elapsed < hourMs) {
    const minutes = Math.floor(elapsed / minuteMs)
    return `${minutes} min ago`
  }
  if (elapsed < dayMs) {
    const hours = Math.floor(elapsed / hourMs)
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  }
  const days = Math.floor(elapsed / dayMs)
  return days === 1 ? '1 day ago' : `${days} days ago`
}
