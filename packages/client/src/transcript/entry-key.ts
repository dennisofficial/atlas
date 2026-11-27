const PART_SEPARATOR = '#'

export const entryKeyOf = ({ eventId, part }: { eventId: string; part: number }): string =>
  `${eventId}${PART_SEPARATOR}${part}`

export const eventIdOfEntryKey = (key: string): string => key.split(PART_SEPARATOR)[0] ?? key
