const DAYS_SHOWN_AS_WEEKDAY = 6
const DAY_MS = 86_400_000

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'long' })
const MONTH_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const MONTH_DAY_YEAR = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

const pad = (value: number): string => String(value).padStart(2, '0')

const clockOf = (date: Date): string => {
  const hours = date.getHours()
  return `${hours % 12 || 12}:${pad(date.getMinutes())} ${hours >= 12 ? 'PM' : 'AM'}`
}

const calendarDaysBetween = ({ from, to }: { from: Date; to: Date }): number => {
  const start = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const end = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((end - start) / DAY_MS)
}

const labelOf = ({ date, today }: { date: Date; today: Date }): string => {
  const daysAgo = calendarDaysBetween({ from: date, to: today })
  if (daysAgo <= 0) return clockOf(date)
  if (daysAgo === 1) return `Yesterday ${clockOf(date)}`
  if (daysAgo <= DAYS_SHOWN_AS_WEEKDAY) return `${WEEKDAY.format(date)} ${clockOf(date)}`
  if (date.getFullYear() === today.getFullYear())
    return `${MONTH_DAY.format(date)} ${clockOf(date)}`
  return MONTH_DAY_YEAR.format(date)
}

export function messageTimeOf(args: { at: string | undefined; now: number }): string | undefined {
  if (args.at === undefined) return undefined
  const date = new Date(args.at)
  if (Number.isNaN(date.getTime())) return undefined
  return labelOf({ date, today: new Date(args.now) })
}
