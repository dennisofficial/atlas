const COMMON_TIMEZONES: readonly string[] = [
  'UTC',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Europe/Lisbon',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Asia/Kolkata',
  'Australia/Sydney',
]

const CHOICE_LIMIT = 60

let cached: readonly string[] | null = null

const supportedZones = (): readonly string[] =>
  typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []

export const timezoneNames = (): readonly string[] => {
  if (cached !== null) return cached
  const common = new Set(COMMON_TIMEZONES)
  const rest = supportedZones()
    .filter((zone) => !common.has(zone))
    .sort((left, right) => left.localeCompare(right))
  cached = [...COMMON_TIMEZONES, ...rest]
  return cached
}

export const timezoneChoicesOf = ({
  query,
  selected,
}: {
  query: string
  selected: string
}): readonly string[] => {
  const needle = query.trim().toLowerCase().replaceAll(' ', '_')
  const names = timezoneNames()
  const matches =
    needle === '' ? names : names.filter((zone) => zone.toLowerCase().includes(needle))
  return [...new Set([selected, ...matches])].filter((zone) => zone !== '').slice(0, CHOICE_LIMIT)
}

export const deviceTimezone = (): string => {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return zone === undefined || zone.length === 0 ? 'UTC' : zone
}
