export enum ECronField {
  Minute = 'minute',
  Hour = 'hour',
  DayOfMonth = 'dayOfMonth',
  Month = 'month',
  DayOfWeek = 'dayOfWeek',
}

export type Cron = {
  expression: string
  minutes: readonly number[]
  hours: readonly number[]
  daysOfMonth: readonly number[]
  months: readonly number[]
  daysOfWeek: readonly number[]
}

export type ParsedCron = { ok: true; cron: Cron } | { ok: false; reason: string }

export class CronNeverFiresError extends Error {
  readonly expression: string

  constructor({ expression }: { expression: string }) {
    super(`cron "${expression}" has no occurrence within five years`)
    this.name = 'CronNeverFiresError'
    this.expression = expression
  }
}
