import 'vitest'

interface AtlasMatchers<R = unknown> {
  toStartWith(prefix: string): R
  toEndWith(suffix: string): R
  toBeString(): R
}

declare module 'vitest' {
  interface Matchers<T = any> extends AtlasMatchers<T> {}
}
