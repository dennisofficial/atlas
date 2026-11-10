import type { Cron, ParsedCron } from './cron'
import { ECronField } from './cron'
import { CronFieldSyntaxError, expandField, fieldSpecFor } from './field'

const FIELD_COUNT = 5
const SUNDAY_ALIAS = 7
const SUNDAY = 0

const ascending = (left: number, right: number): number => left - right

const buildDaysOfWeek = (text: string): number[] => {
  const values = expandField({ text, spec: fieldSpecFor(ECronField.DayOfWeek) }).map((value) =>
    value === SUNDAY_ALIAS ? SUNDAY : value,
  )
  return [...new Set(values)].sort(ascending)
}

const buildCron = (fields: readonly string[]): Cron => {
  const [minutes = '', hours = '', daysOfMonth = '', months = '', daysOfWeek = ''] = fields
  return {
    expression: fields.join(' '),
    minutes: expandField({ text: minutes, spec: fieldSpecFor(ECronField.Minute) }),
    hours: expandField({ text: hours, spec: fieldSpecFor(ECronField.Hour) }),
    daysOfMonth: expandField({ text: daysOfMonth, spec: fieldSpecFor(ECronField.DayOfMonth) }),
    months: expandField({ text: months, spec: fieldSpecFor(ECronField.Month) }),
    daysOfWeek: buildDaysOfWeek(daysOfWeek),
  }
}

export const parseCron = (expression: string): ParsedCron => {
  const fields = expression
    .trim()
    .split(/\s+/)
    .filter((field) => field !== '')
  if (fields.length !== FIELD_COUNT) {
    return { ok: false, reason: `expected ${FIELD_COUNT} fields but found ${fields.length}` }
  }
  try {
    return { ok: true, cron: buildCron(fields) }
  } catch (error) {
    if (error instanceof CronFieldSyntaxError) return { ok: false, reason: error.message }
    throw error
  }
}
