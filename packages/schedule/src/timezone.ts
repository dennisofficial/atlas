const MS_PER_DAY = 86_400_000
const MS_PER_SECOND = 1000

export type WallClock = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

const formatterFor = (timezone: string): Intl.DateTimeFormat => {
  const cached = formatters.get(timezone)
  if (cached !== undefined) return cached
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  formatters.set(timezone, formatter)
  return formatter
}

const readPart = ({ parts, type }: { parts: Intl.DateTimeFormatPart[]; type: string }): number => {
  const part = parts.find((candidate) => candidate.type === type)
  return part === undefined ? 0 : Number(part.value)
}

export const wallClockAt = ({
  instant,
  timezone,
}: {
  instant: number
  timezone: string
}): WallClock => {
  const parts = formatterFor(timezone).formatToParts(new Date(instant))
  return {
    year: readPart({ parts, type: 'year' }),
    month: readPart({ parts, type: 'month' }),
    day: readPart({ parts, type: 'day' }),
    hour: readPart({ parts, type: 'hour' }),
    minute: readPart({ parts, type: 'minute' }),
    second: readPart({ parts, type: 'second' }),
  }
}

const asUtc = (wall: WallClock): number =>
  Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second)

const offsetAt = ({ instant, timezone }: { instant: number; timezone: string }): number => {
  const second = Math.floor(instant / MS_PER_SECOND) * MS_PER_SECOND
  return asUtc(wallClockAt({ instant: second, timezone })) - second
}

const distinct = (values: readonly number[]): number[] => [...new Set(values)]

export const instantFor = ({ wall, timezone }: { wall: WallClock; timezone: string }): number => {
  const naive = asUtc(wall)
  const offsets = distinct([
    offsetAt({ instant: naive - MS_PER_DAY, timezone }),
    offsetAt({ instant: naive, timezone }),
    offsetAt({ instant: naive + MS_PER_DAY, timezone }),
  ])
  const exact = offsets
    .map((offset) => ({ offset, instant: naive - offset }))
    .filter(({ offset, instant }) => offsetAt({ instant, timezone }) === offset)
    .map(({ instant }) => instant)
  if (exact.length > 0) return Math.min(...exact)
  return Math.max(...offsets.map((offset) => naive - offset))
}
