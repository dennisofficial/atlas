const pad = (value: number): string => String(value).padStart(2, '0')

export function clockTimeOf(at: string | undefined): string | undefined {
  if (at === undefined) return undefined
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return undefined
  const hours = date.getHours()
  return `${hours % 12 || 12}:${pad(date.getMinutes())} ${hours >= 12 ? 'PM' : 'AM'}`
}
