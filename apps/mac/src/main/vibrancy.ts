import { dlopen, FFIType, type Pointer } from 'bun:ffi'

const LIBOBJC = '/usr/lib/libobjc.A.dylib'
const MATERIAL_SIDEBAR = 7
const BLENDING_BEHIND_WINDOW = 0
const STATE_FOLLOWS_WINDOW_ACTIVE = 0
const WINDOW_BELOW = -1
const WIDTH_AND_HEIGHT_SIZABLE = 18

export const VIBRANCY_PRELOAD = 'window.atlasDesktop = Object.freeze({ vibrancy: true })'

export type TObjcArg =
  | { type: 'ptr'; value: Pointer | null }
  | { type: 'int'; value: number }
  | { type: 'rect'; width: number; height: number }

export interface IObjcRuntime {
  getClass: (name: string) => Pointer | null
  send: (call: { receiver: Pointer | null; selector: string; args?: TObjcArg[] }) => Pointer | null
}

const toPointer = (value: unknown): Pointer | null => {
  if (typeof value === 'number') return value as Pointer
  if (typeof value === 'bigint') return Number(value) as Pointer
  return null
}

const ffiTypesOf = (arg: TObjcArg): FFIType[] => {
  if (arg.type === 'ptr') return [FFIType.ptr]
  if (arg.type === 'int') return [FFIType.i64]
  return [FFIType.f64, FFIType.f64, FFIType.f64, FFIType.f64]
}

const valuesOf = (arg: TObjcArg): (Pointer | null | number)[] => {
  if (arg.type === 'rect') return [0, 0, arg.width, arg.height]
  return [arg.value]
}

// objc_msgSend must be called through its true signature; a CGRect argument is passed as four doubles on arm64 (AAPCS64 HFA) but not on x86_64, so Intel Macs are skipped.
// https://developer.apple.com/documentation/objectivec/objc_msgsend
export function createObjcRuntime(): IObjcRuntime | null {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') return null
  const base = dlopen(LIBOBJC, {
    objc_getClass: { args: [FFIType.cstring], returns: FFIType.ptr },
    sel_registerName: { args: [FFIType.cstring], returns: FFIType.ptr },
  }).symbols
  const cstr = (text: string) => Buffer.from(`${text}\0`)
  const senders = new Map<string, (...args: unknown[]) => unknown>()
  const senderFor = (args: TObjcArg[]) => {
    const key = args.map((arg) => arg.type).join()
    const cached = senders.get(key)
    if (cached) return cached
    const symbol = dlopen(LIBOBJC, {
      objc_msgSend: {
        args: [FFIType.ptr, FFIType.ptr, ...args.flatMap(ffiTypesOf)],
        returns: FFIType.ptr,
      },
    }).symbols.objc_msgSend
    senders.set(key, symbol)
    return symbol
  }
  return {
    getClass: (name) => toPointer(base.objc_getClass(cstr(name))),
    send: ({ receiver, selector, args = [] }) =>
      toPointer(
        senderFor(args)(receiver, base.sel_registerName(cstr(selector)), ...args.flatMap(valuesOf)),
      ),
  }
}

export function vibrancySupported(runtime: IObjcRuntime | null = createObjcRuntime()): boolean {
  return runtime?.getClass('NSVisualEffectView') != null
}

export function applyVibrancy({
  windowPtr,
  width,
  height,
  runtime = createObjcRuntime(),
}: {
  windowPtr: Pointer | null
  width: number
  height: number
  runtime?: IObjcRuntime | null
}): boolean {
  const effectClass = runtime?.getClass('NSVisualEffectView')
  if (!runtime || !effectClass || !windowPtr) return false
  const send = (receiver: Pointer | null, selector: string, args?: TObjcArg[]) =>
    runtime.send({ receiver, selector, ...(args ? { args } : {}) })
  const int = (value: number): TObjcArg => ({ type: 'int', value })
  const contentView = send(windowPtr, 'contentView')
  const effect = send(send(effectClass, 'alloc'), 'init')
  if (!contentView || !effect) return false
  send(effect, 'setMaterial:', [int(MATERIAL_SIDEBAR)])
  send(effect, 'setBlendingMode:', [int(BLENDING_BEHIND_WINDOW)])
  send(effect, 'setState:', [int(STATE_FOLLOWS_WINDOW_ACTIVE)])
  send(effect, 'setFrame:', [{ type: 'rect', width, height }])
  send(effect, 'setAutoresizingMask:', [int(WIDTH_AND_HEIGHT_SIZABLE)])
  send(contentView, 'addSubview:positioned:relativeTo:', [
    { type: 'ptr', value: effect },
    int(WINDOW_BELOW),
    { type: 'ptr', value: null },
  ])
  return true
}
