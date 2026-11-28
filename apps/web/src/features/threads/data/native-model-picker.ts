import { z } from 'zod'

import { type ModelOption } from '@dltech/atlas-ui/ai/model-selector'

import { hasNativeModelPicker } from '@/features/desktop/desktop-attributes'

import { effortOfName, type ModelSelection, selectionAfterPick } from './model-selection'

export const ENativeModelPick = {
  Select: 'select',
  Pin: 'pin',
  Dismiss: 'dismiss',
  Error: 'error',
}

export const MODEL_LIMIT = 200

export type DOMRectLike = { x: number; y: number; width: number; height: number }

export type NativePickerModel = {
  id: string
  label: string
  provider?: string
  context?: string
  rate?: string
  monogram?: string
  disabled?: boolean
  disabledNote?: string
  fast?: boolean
  efforts?: string[]
  effortLabels?: Record<string, string>
}

export type NativePickerPayload = {
  models: NativePickerModel[]
  selected: { id: string; effort: string; fast: boolean }
  pinned: string[]
}

export type NativePickerRequest = NativePickerPayload & { anchor: DOMRectLike }

export type NativePickerEvent = {
  kind: string
  generation?: number
  modelId?: string
  effort?: string
  fast?: boolean
  dismiss?: boolean
  message?: string
}

export type NativePickerOutcome =
  | { kind: 'select'; selection: ModelSelection; dismiss: boolean }
  | { kind: 'pin'; id: string }
  | { kind: 'dismiss' }
  | { kind: 'error'; message: string }

type NativeBridge = {
  showModelPicker: (request: NativePickerRequest) => Promise<unknown>
  hideModelPicker: () => Promise<unknown>
  onModelPickerEvent: (listener: (event: unknown) => void) => void
  offModelPickerEvent: (listener: (event: unknown) => void) => void
}

const eventSchema = z.object({
  kind: z.string(),
  generation: z.number().optional(),
  modelId: z.string().optional(),
  effort: z.string().optional(),
  fast: z.boolean().optional(),
  dismiss: z.boolean().optional(),
  message: z.string().optional(),
})

function bridgeOf(host: object): NativeBridge | null {
  const bridge: unknown = Reflect.get(host, 'atlasDesktop')
  if (typeof bridge !== 'object' || bridge === null) return null
  const names = ['showModelPicker', 'hideModelPicker', 'onModelPickerEvent', 'offModelPickerEvent']
  if (!names.every((name) => typeof Reflect.get(bridge, name) === 'function')) return null
  return bridge as NativeBridge
}

export function nativePickerAvailable(host: object): boolean {
  return hasNativeModelPicker(host) && bridgeOf(host) !== null
}

function nativeModelOf(model: ModelOption): NativePickerModel {
  return {
    id: model.id,
    label: model.label,
    ...(model.provider === undefined ? {} : { provider: model.provider }),
    ...(model.context === undefined ? {} : { context: model.context }),
    ...(model.rate === undefined ? {} : { rate: model.rate }),
    ...(model.monogram === undefined ? {} : { monogram: model.monogram }),
    ...(model.disabled === true ? { disabled: true } : {}),
    ...(model.disabledNote === undefined ? {} : { disabledNote: model.disabledNote }),
    ...(model.fast === true ? { fast: true } : {}),
    ...(model.efforts === undefined ? {} : { efforts: [...model.efforts] }),
    ...(model.effortLabels === undefined ? {} : { effortLabels: { ...model.effortLabels } }),
  }
}

export function nativePickerPayload({
  models,
  selection,
  pinned,
}: {
  models: readonly ModelOption[]
  selection: ModelSelection
  pinned: readonly string[]
}): NativePickerPayload {
  return {
    models: models.slice(0, MODEL_LIMIT).map(nativeModelOf),
    selected: { id: selection.id, effort: selection.effort, fast: selection.fast },
    pinned: pinned.slice(0, 50),
  }
}

export function nativePickerRequest({
  payload,
  anchor,
}: {
  payload: NativePickerPayload
  anchor: DOMRectLike
}): NativePickerRequest {
  return {
    ...payload,
    anchor: { x: anchor.x, y: anchor.y, width: anchor.width, height: anchor.height },
  }
}

export async function showNativePicker({
  host,
  anchor,
  payload,
}: {
  host: object
  anchor: DOMRectLike
  payload: NativePickerPayload
}): Promise<boolean> {
  const bridge = bridgeOf(host)
  if (bridge === null) return false
  try {
    const answer: unknown = await bridge.showModelPicker.call(
      bridge,
      nativePickerRequest({ payload, anchor }),
    )
    return typeof answer === 'object' && answer !== null && Reflect.get(answer, 'ok') === true
  } catch {
    return false
  }
}

export function hideNativePicker({ host }: { host: object }): void {
  const bridge = bridgeOf(host)
  if (bridge === null) return
  bridge.hideModelPicker.call(bridge).catch(() => undefined)
}

export function watchNativePicker({
  host,
  onPick,
}: {
  host: object
  onPick: (event: NativePickerEvent) => void
}): () => void {
  const bridge = bridgeOf(host)
  if (bridge === null) return () => undefined
  const listener = (value: unknown) => {
    const parsed = eventSchema.safeParse(value)
    if (parsed.success) onPick(parsed.data)
  }
  bridge.onModelPickerEvent.call(bridge, listener)
  return () => {
    bridge.offModelPickerEvent.call(bridge, listener)
  }
}

export function outcomeOf({
  models,
  selection,
  event,
}: {
  models: readonly ModelOption[]
  selection: ModelSelection
  event: NativePickerEvent
}): NativePickerOutcome {
  switch (event.kind) {
    case ENativeModelPick.Select:
      return {
        kind: 'select',
        dismiss: event.dismiss !== false,
        selection: selectionAfterPick({
          models,
          id: event.modelId ?? selection.id,
          effort: effortOfName(event.effort),
          fast: event.fast === true,
        }),
      }
    case ENativeModelPick.Pin:
      return { kind: 'pin', id: event.modelId ?? '' }
    case ENativeModelPick.Error:
      return { kind: 'error', message: event.message ?? 'the native model picker failed' }
    default:
      return { kind: 'dismiss' }
  }
}
