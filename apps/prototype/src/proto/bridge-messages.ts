import type { Control } from './use-prototype'

export enum EProtoMessage {
  Controls = 'controls',
  Location = 'location',
  Set = 'set',
  Reset = 'reset',
  Theme = 'theme',
}

export enum ETheme {
  Light = 'light',
  Dark = 'dark',
}

export type ControlValue = string | boolean | number

export interface ControlsMessage {
  kind: EProtoMessage.Controls
  path: string
  controls: Record<string, Control>
  values: Record<string, ControlValue>
}

export interface LocationMessage {
  kind: EProtoMessage.Location
  path: string
}

export interface SetMessage {
  kind: EProtoMessage.Set
  key: string
  value: ControlValue
}

export interface ResetMessage {
  kind: EProtoMessage.Reset
}

export interface ThemeMessage {
  kind: EProtoMessage.Theme
  theme: ETheme
}

export type PageMessage = ControlsMessage | LocationMessage
export type ChromeMessage = SetMessage | ResetMessage | ThemeMessage

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isControlValue(value: unknown): value is ControlValue {
  return ['string', 'boolean', 'number'].includes(typeof value)
}

function isControl(value: unknown): value is Control {
  if (!isRecord(value) || typeof value.label !== 'string') return false
  if (value.type === 'select') {
    return Array.isArray(value.options) && typeof value.default === 'string'
  }
  if (value.type === 'boolean') return typeof value.default === 'boolean'
  if (value.type !== 'range') return false
  return [value.min, value.max, value.default].every((entry) => typeof entry === 'number')
}

export function toControlValues(values: object): Record<string, ControlValue> {
  const entries = Object.entries(values).filter((entry): entry is [string, ControlValue] =>
    isControlValue(entry[1]),
  )
  return Object.fromEntries(entries)
}

function readControls(raw: unknown): Record<string, Control> | null {
  if (!isRecord(raw)) return null
  const controls: Record<string, Control> = {}
  for (const [key, control] of Object.entries(raw)) {
    if (!isControl(control)) return null
    controls[key] = control
  }
  return controls
}

function readValues(raw: unknown): Record<string, ControlValue> | null {
  if (!isRecord(raw)) return null
  const values: Record<string, ControlValue> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!isControlValue(value)) return null
    values[key] = value
  }
  return values
}

export function parsePageMessage(data: unknown): PageMessage | null {
  if (!isRecord(data) || typeof data.path !== 'string') return null
  if (data.kind === EProtoMessage.Location) return { kind: EProtoMessage.Location, path: data.path }
  if (data.kind !== EProtoMessage.Controls) return null
  const controls = readControls(data.controls)
  const values = readValues(data.values)
  if (!controls || !values) return null
  return { kind: EProtoMessage.Controls, path: data.path, controls, values }
}

export function parseChromeMessage(data: unknown): ChromeMessage | null {
  if (!isRecord(data)) return null
  if (data.kind === EProtoMessage.Reset) return { kind: EProtoMessage.Reset }
  if (data.kind === EProtoMessage.Theme) {
    if (data.theme === ETheme.Light) return { kind: EProtoMessage.Theme, theme: ETheme.Light }
    return data.theme === ETheme.Dark ? { kind: EProtoMessage.Theme, theme: ETheme.Dark } : null
  }
  if (data.kind !== EProtoMessage.Set) return null
  if (typeof data.key !== 'string' || !isControlValue(data.value)) return null
  return { kind: EProtoMessage.Set, key: data.key, value: data.value }
}

export function applyControlMessage({
  search,
  controls,
  message,
}: {
  search: string
  controls: Record<string, Control>
  message: SetMessage | ResetMessage
}): string | null {
  const params = new URLSearchParams(search)
  if (message.kind === EProtoMessage.Reset) {
    for (const key of Object.keys(controls)) params.delete(key)
    return params.toString()
  }
  if (!(message.key in controls)) return null
  params.set(message.key, String(message.value))
  return params.toString()
}
