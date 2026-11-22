# @dltech/bun-test-shims

The vitest `vi.*` helpers that `bun:test` does not provide: a flush-aware timer advance, `waitFor`,
env and global stubs, and a test timeout. Specs import one of these instead of adding vitest.

## Owns

- A version of `advanceTimersByTimeAsync` that flushes pending work before and after one
  `vi.advanceTimersByTime` call.
- A `waitFor` that polls with the fake clock when fake timers are active, and with the real clock
  otherwise.
- `stubEnv`, `unstubAllEnvs`, `stubGlobal` and `unstubAllGlobals`, with a save and restore.
- `setTestTimeout`, and a passthrough for a trivially hoisted value.

## Does not own

- `vi.fn`, `vi.spyOn`, `vi.mock` and `vi.useFakeTimers`. `bun:test` already exports them on its own
  `vi`. Use that export.
- Module mocking at import time. `bun:test` hoists nothing.

## Entry points

| Import                   | Use it for                         |
| ------------------------ | ---------------------------------- |
| `@dltech/bun-test-shims` | The helpers that `bun:test` lacks. |

## Capabilities

### Control the clock

- `advanceTimersByTimeAsync(ms)`: flushes work, advances the fake clock in one call, then flushes
  work again.
- `waitFor(assertion, options)`: retries the assertion until it stops throwing. With fake timers it
  ignores `timeout` and `interval`, and it makes 200 attempts of 20 ms. With real timers it uses
  the options.

### Replace the environment

- `stubEnv(name, value)`: sets `process.env[name]`, and remembers the first original value.
- `unstubAllEnvs()`: restores every stubbed variable.
- `stubGlobal(name, value)`: sets a `globalThis` slot, and remembers whether it existed.
- `unstubAllGlobals()`: restores every stubbed global.

### Shape the test

- `setTestTimeout(ms)`: sets the timeout through `jest.setTimeout`.
- `hoisted(factory)`: calls the factory at once. It does not hoist anything.

## Usage

This is the pattern in the API specs: stub in the test, restore after each test.

```ts
import { afterEach, vi } from 'bun:test'
import { stubGlobal, unstubAllGlobals } from '@dltech/bun-test-shims'

afterEach(() => {
  unstubAllGlobals()
  vi.useRealTimers()
})

stubGlobal('fetch', fakeFetch)
```

## Rules

- Import from `@dltech/bun-test-shims` only in a spec.
- Call `unstubAllEnvs` and `unstubAllGlobals` in an `afterEach` hook. `bun:test` restores nothing.
- Do not use `hoisted` when the value must exist before another module loads. Move the value to
  module scope instead.

## See also

- `packages/bun-test-incremental` for the test preload that this package works with.
