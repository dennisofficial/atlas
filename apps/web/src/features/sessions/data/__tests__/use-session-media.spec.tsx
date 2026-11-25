import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import * as realSonner from 'sonner'

import { EPromptAttachmentStatus } from '@dltech/atlas-ui/ai/prompt-input'

import { uploadFailedNotice } from '@dltech/atlas-client/session'
import * as realEncode from '@/features/threads/data/image-encode'

const realSonnerExports = { ...realSonner }

const attempted: File[] = []
const shownErrors: string[] = []

mock.module('sonner', () => ({
  toast: Object.assign(() => undefined, { error: (title: string) => shownErrors.push(title) }),
}))

mock.module('@/features/threads/data/image-encode', () => ({
  ...realEncode,
  encodeImage: async (args: { file: File }) => {
    attempted.push(args.file)
    throw new Error('the browser cannot decode this file')
  },
}))

const { useSessionMedia } = await import('../use-session-media')

type MediaApi = ReturnType<typeof useSessionMedia>

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  mock.module('sonner', () => realSonnerExports)
  mock.module('@/features/threads/data/image-encode', () => realEncode)
  await unregisterDom()
})

afterEach(async () => {
  const mounted = root
  if (mounted !== null) await act(async () => mounted.unmount())
  root = null
  container?.remove()
  container = null
  attempted.length = 0
  shownErrors.length = 0
})

const heic = () => new File(['x'], 'IMG_0042.HEIC', { type: 'image/heic' })

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const mount = async (deps: { onUnreadable?: (file: File) => void }): Promise<() => MediaApi> => {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  const instance = createRoot(host)
  let latest: MediaApi | undefined

  function Probe() {
    latest = useSessionMedia(deps)
    return <p>{latest.composerProps.attachments.length}</p>
  }

  await act(async () => instance.render(<Probe />))
  root = instance
  container = host

  return () => {
    if (latest === undefined) throw new Error('the probe never rendered')
    return latest
  }
}

describe('useSessionMedia on a file the browser cannot decode', () => {
  it('hands it to the file path and leaves no failed chip behind', async () => {
    const fallback: File[] = []
    const api = await mount({ onUnreadable: (file) => fallback.push(file) })
    const file = heic()

    await act(async () => {
      api().attach([file])
      await settle()
    })

    expect(attempted).toEqual([file])
    expect(fallback).toEqual([file])
    expect(api().composerProps.attachments).toEqual([])
    expect(api().uploading).toBe(false)
    expect(shownErrors).toEqual([])
  })

  it('marks the chip failed when nothing can take the file instead', async () => {
    const api = await mount({})

    await act(async () => {
      api().attach([heic()])
      await settle()
    })

    expect(api().composerProps.attachments.map((chip) => chip.status)).toEqual([
      EPromptAttachmentStatus.Failed,
    ])
    expect(shownErrors).toEqual([uploadFailedNotice('IMG_0042.HEIC')])
  })
})
