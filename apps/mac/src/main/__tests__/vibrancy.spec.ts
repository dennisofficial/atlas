import { describe, expect, test } from 'bun:test'
import type { Pointer } from 'bun:ffi'
import { applyVibrancy, type IObjcRuntime, type TObjcArg } from '../vibrancy'

const ptr = (n: number) => n as Pointer

function fakeRuntime(classes: string[]) {
  const calls: { selector: string; args: TObjcArg[] }[] = []
  const runtime: IObjcRuntime = {
    getClass: (name) => (classes.includes(name) ? ptr(100) : null),
    send: ({ selector, args = [] }) => {
      calls.push({ selector, args })
      return ptr(200)
    },
  }
  return { runtime, calls }
}

describe('applyVibrancy', () => {
  test('configures a sidebar effect view behind the content', () => {
    const { runtime, calls } = fakeRuntime(['NSVisualEffectView'])
    expect(applyVibrancy({ windowPtr: ptr(1), width: 1280, height: 820, runtime })).toBe(true)
    const names = calls.map((c) => c.selector)
    expect(names).toEqual([
      'contentView',
      'alloc',
      'init',
      'setMaterial:',
      'setBlendingMode:',
      'setState:',
      'setFrame:',
      'setAutoresizingMask:',
      'addSubview:positioned:relativeTo:',
    ])
    expect(calls[3]?.args).toEqual([{ type: 'int', value: 7 }])
    expect(calls[8]?.args[1]).toEqual({ type: 'int', value: -1 })
  })
  test('does nothing without the class, the window or a runtime', () => {
    expect(
      applyVibrancy({ windowPtr: ptr(1), width: 1, height: 1, runtime: fakeRuntime([]).runtime }),
    ).toBe(false)
    expect(
      applyVibrancy({
        windowPtr: null,
        width: 1,
        height: 1,
        runtime: fakeRuntime(['NSVisualEffectView']).runtime,
      }),
    ).toBe(false)
    expect(applyVibrancy({ windowPtr: ptr(1), width: 1, height: 1, runtime: null })).toBe(false)
  })
})
