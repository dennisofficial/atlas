const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
const TWELVE_HOURS = 12
const NOON_HOUR = 12
const MIDNIGHT_HOUR = 0
const DEFAULT_HOUR = 9
const DEFAULT_MINUTE = 0

const CLOCK_WORD = /\b(?:at\s+)?(noon|midnight)\b/
const MERIDIEM_TIME = /\b(?:at\s+)?(\d{1,2})(?::(\d{1,2}))?\s?(am|pm)\b/
const COLON_TIME = /\b(?:at\s+)?(\d{1,2}):(\d{1,2})\b/
const AT_HOUR = /\bat\s+(\d{1,2})\b/

export enum EClockWord {
  Noon = 'noon',
  Midnight = 'midnight',
}

export enum EMeridiem {
  Am = 'am',
  Pm = 'pm',
}

export type Clock = { readonly hour: number; readonly minute: number }

export type ExtractedClock =
  | { ok: true; clock: Clock; rest: string }
  | { ok: false; reason: string }

type ParsedClock = { ok: true; clock: Clock } | { ok: false; reason: string }

const UNREADABLE_TIME = 'That is not a time I can read. Try "7am", "7:30pm" or "19:45".'
const MINUTE_RANGE = 'Minutes run from 0 to 59, so try a minute like 45.'
const HOUR_RANGE = 'Hours run from 1 to 23, or from 1 to 12 with am or pm.'

const DEFAULT_CLOCK: Clock = { hour: DEFAULT_HOUR, minute: DEFAULT_MINUTE }

const remainderOf = ({ text, match }: { text: string; match: RegExpExecArray }): string =>
  `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`

const settle = ({
  text,
  match,
  parsed,
}: {
  text: string
  match: RegExpExecArray
  parsed: ParsedClock
}): ExtractedClock =>
  parsed.ok ? { ok: true, clock: parsed.clock, rest: remainderOf({ text, match }) } : parsed

const clockOfWord = (word: string): ParsedClock => {
  if (word === EClockWord.Noon) return { ok: true, clock: { hour: NOON_HOUR, minute: 0 } }
  if (word === EClockWord.Midnight) return { ok: true, clock: { hour: MIDNIGHT_HOUR, minute: 0 } }
  return { ok: false, reason: UNREADABLE_TIME }
}

const clockOfMeridiem = ({
  hour,
  minute,
  meridiem,
}: {
  hour: number
  minute: number
  meridiem: EMeridiem
}): ParsedClock => {
  if (hour < 1 || hour > TWELVE_HOURS) return { ok: false, reason: HOUR_RANGE }
  if (minute < 0 || minute >= MINUTES_PER_HOUR) return { ok: false, reason: MINUTE_RANGE }
  const onTheHour = hour % TWELVE_HOURS
  const hourOfDay = meridiem === EMeridiem.Pm ? onTheHour + TWELVE_HOURS : onTheHour
  return { ok: true, clock: { hour: hourOfDay, minute } }
}

const clockOfDay = ({
  hour,
  minute,
  withMinutes,
}: {
  hour: number
  minute: number
  withMinutes: boolean
}): ParsedClock => {
  if (minute < 0 || minute >= MINUTES_PER_HOUR) return { ok: false, reason: MINUTE_RANGE }
  if (hour < (withMinutes ? 0 : 1) || hour >= HOURS_PER_DAY) {
    return { ok: false, reason: HOUR_RANGE }
  }
  return { ok: true, clock: { hour, minute } }
}

export const extractClock = (text: string): ExtractedClock => {
  const word = CLOCK_WORD.exec(text)
  if (word !== null) return settle({ text, match: word, parsed: clockOfWord(word[1] ?? '') })
  const meridiem = MERIDIEM_TIME.exec(text)
  if (meridiem !== null) {
    const parsed = clockOfMeridiem({
      hour: Number(meridiem[1] ?? ''),
      minute: Number(meridiem[2] ?? DEFAULT_MINUTE),
      meridiem: meridiem[3] === EMeridiem.Pm ? EMeridiem.Pm : EMeridiem.Am,
    })
    return settle({ text, match: meridiem, parsed })
  }
  const colon = COLON_TIME.exec(text)
  if (colon !== null) {
    const parsed = clockOfDay({
      hour: Number(colon[1] ?? ''),
      minute: Number(colon[2] ?? DEFAULT_MINUTE),
      withMinutes: true,
    })
    return settle({ text, match: colon, parsed })
  }
  const at = AT_HOUR.exec(text)
  if (at !== null) {
    const parsed = clockOfDay({
      hour: Number(at[1] ?? ''),
      minute: DEFAULT_MINUTE,
      withMinutes: false,
    })
    return settle({ text, match: at, parsed })
  }
  return { ok: true, clock: DEFAULT_CLOCK, rest: text }
}
