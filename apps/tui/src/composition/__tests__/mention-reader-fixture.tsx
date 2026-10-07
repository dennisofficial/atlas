import type { DirectoryEntry } from '@dltech/atlas-core'
import type { MentionReader } from '@dltech/atlas-harness'
import { KeyEvent } from '@opentui/core'
import { createTestRenderer, type TestRendererSetup } from '@opentui/core/testing'
import { createRoot, type Root } from '@opentui/react'
import React, { act, useState } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

export type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

export function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined
  let reject: (reason: unknown) => void = () => undefined
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept
    reject = decline
  })
  return { promise, resolve, reject }
}

export const file = (name: string): DirectoryEntry => ({
  name,
  isDirectory: false,
})

export type ScriptedReader = MentionReader & {
  listed: string[]
  checked: string[]
  pendingLists: Deferred<readonly DirectoryEntry[]>[]
  pendingChecks: Deferred<boolean>[]
}

export function scriptedReader(): ScriptedReader {
  const pendingLists: Deferred<readonly DirectoryEntry[]>[] = []
  const pendingChecks: Deferred<boolean>[] = []
  const listed: string[] = []
  const checked: string[] = []

  return {
    listed,
    checked,
    pendingLists,
    pendingChecks,
    list: (directory) => {
      listed.push(directory)
      const asked = deferred<readonly DirectoryEntry[]>()
      pendingLists.push(asked)
      return asked.promise
    },
    exists: (path) => {
      checked.push(path)
      const asked = deferred<boolean>()
      pendingChecks.push(asked)
      return asked.promise
    },
    load: () => Promise.reject(new Error('the composer never loads')),
    forget: () => undefined,
  }
}

export const press = (name: string): KeyEvent =>
  new KeyEvent({
    name,
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    sequence: '',
    number: false,
    raw: '',
    eventType: 'press',
    source: 'raw',
  })

export type Mounted<Props> = {
  setup: TestRendererSetup
  root: Root
  rerender: (props: Props) => Promise<void>
  act: (work: () => void | Promise<void>) => Promise<void>
  done: () => Promise<void>
}

export async function mountProbe<Props>(args: {
  render: (props: Props) => React.ReactNode
  props: Props
}): Promise<Mounted<Props>> {
  const setup = await createTestRenderer({ width: 40, height: 4 })
  const root = createRoot(setup.renderer)

  let setProps: (props: Props) => void = () => undefined

  function Wrapper(): React.ReactNode {
    const [props, update] = useState<Props>(args.props)
    setProps = update
    return args.render(props)
  }

  await act(async () => {
    root.render(<Wrapper />)
    await setup.flush()
  })

  const draw = async (props: Props): Promise<void> => {
    await act(async () => {
      setProps(props)
      await setup.flush()
    })
  }

  return {
    setup,
    root,
    rerender: draw,
    act: (work) =>
      act(async () => {
        await work()
        await setup.flush()
      }),
    done: async () => {
      await act(async () => root.unmount())
      setup.renderer.destroy()
    },
  }
}

export function trackUnhandledRejections(): {
  seen: unknown[]
  stop: () => void
} {
  const seen: unknown[] = []
  const record = (reason: unknown): void => {
    seen.push(reason)
  }
  process.on('unhandledRejection', record)
  return { seen, stop: () => process.off('unhandledRejection', record) }
}
