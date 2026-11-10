import { ECronField } from './cron'

const MONTH_NAMES: Readonly<Record<string, number>> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
}

const WEEKDAY_NAMES: Readonly<Record<string, number>> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
}

const NO_NAMES: Readonly<Record<string, number>> = {}

export type FieldSpec = {
  readonly field: ECronField
  readonly min: number
  readonly max: number
  readonly names: Readonly<Record<string, number>>
}

const SPECS: Readonly<Record<ECronField, FieldSpec>> = {
  [ECronField.Minute]: { field: ECronField.Minute, min: 0, max: 59, names: NO_NAMES },
  [ECronField.Hour]: { field: ECronField.Hour, min: 0, max: 23, names: NO_NAMES },
  [ECronField.DayOfMonth]: { field: ECronField.DayOfMonth, min: 1, max: 31, names: NO_NAMES },
  [ECronField.Month]: { field: ECronField.Month, min: 1, max: 12, names: MONTH_NAMES },
  [ECronField.DayOfWeek]: { field: ECronField.DayOfWeek, min: 0, max: 7, names: WEEKDAY_NAMES },
}

export const fieldSpecFor = (field: ECronField): FieldSpec => SPECS[field]

export class CronFieldSyntaxError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'CronFieldSyntaxError'
  }
}

const fail = (message: string): never => {
  throw new CronFieldSyntaxError(message)
}

const parseValue = ({ text, spec }: { text: string; spec: FieldSpec }): number => {
  const named = spec.names[text.toUpperCase()]
  if (named !== undefined) return named
  if (!/^\d+$/.test(text)) return fail(`${spec.field}: "${text}" is neither a number nor a name`)
  const value = Number(text)
  if (value < spec.min || value > spec.max) {
    return fail(`${spec.field}: ${value} is outside ${spec.min}-${spec.max}`)
  }
  return value
}

const parseStep = ({ text, spec }: { text: string; spec: FieldSpec }): number => {
  if (!/^\d+$/.test(text)) return fail(`${spec.field}: step "${text}" is not a number`)
  const step = Number(text)
  if (step < 1) return fail(`${spec.field}: step ${step} must be at least 1`)
  return step
}

type Bounds = { start: number; end: number; openEnd: boolean }

const parseBounds = ({ text, spec }: { text: string; spec: FieldSpec }): Bounds => {
  if (text === '*') return { start: spec.min, end: spec.max, openEnd: true }
  const parts = text.split('-')
  if (parts.length > 2) return fail(`${spec.field}: "${text}" is not a range`)
  const [startText, endText] = parts
  if (startText === undefined || startText === '') {
    return fail(`${spec.field}: "${text}" has no value`)
  }
  const start = parseValue({ text: startText, spec })
  if (endText === undefined) return { start, end: start, openEnd: true }
  const end = parseValue({ text: endText, spec })
  if (end < start) return fail(`${spec.field}: "${text}" runs backwards`)
  return { start, end, openEnd: false }
}

const expandItem = ({ item, spec }: { item: string; spec: FieldSpec }): number[] => {
  const parts = item.split('/')
  if (parts.length > 2) return fail(`${spec.field}: "${item}" carries more than one step`)
  const [boundsText = '', stepText] = parts
  const step = stepText === undefined ? 1 : parseStep({ text: stepText, spec })
  const bounds = parseBounds({ text: boundsText, spec })
  const end = stepText !== undefined && bounds.openEnd ? spec.max : bounds.end
  const values: number[] = []
  for (let value = bounds.start; value <= end; value += step) values.push(value)
  return values
}

export const expandField = ({ text, spec }: { text: string; spec: FieldSpec }): number[] => {
  if (text === '') return fail(`${spec.field}: field is empty`)
  const values = text.split(',').flatMap((item) => expandItem({ item, spec }))
  return [...new Set(values)].sort((left, right) => left - right)
}
