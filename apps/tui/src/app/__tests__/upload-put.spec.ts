import { describe, expect, test } from 'bun:test'

import { putBytes, putImageOf } from '../upload-put'

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text)

type Seen = { url: string; init: RequestInit | undefined }

describe('putBytes', () => {
  test('PUTs the bytes with the content type', async () => {
    const seen: Seen[] = []
    const fetchFn = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      seen.push({ url: String(input), init })
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const progress: number[] = []
    const handle = putBytes({
      url: 'https://upload.example.test/1',
      bytes: bytesOf('png'),
      mediaType: 'image/png',
      onProgress: (fraction) => progress.push(fraction),
      fetchFn,
    })

    await handle.done

    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toBe('https://upload.example.test/1')
    expect(seen[0]?.init?.method).toBe('PUT')
    expect(seen[0]?.init?.headers).toEqual({ 'content-type': 'image/png' })
    expect(progress).toEqual([1])
  })

  test('rejects with the status when the upload is refused', async () => {
    const fetchFn = (async () => new Response(null, { status: 500 })) as unknown as typeof fetch

    const handle = putBytes({
      url: 'https://upload.example.test/1',
      bytes: bytesOf('png'),
      mediaType: 'image/png',
      onProgress: () => undefined,
      fetchFn,
    })

    await expect(handle.done).rejects.toThrow('the upload failed with 500')
  })

  test('abort rejects the promise', async () => {
    const fetchFn = ((_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })) as unknown as typeof fetch

    const handle = putBytes({
      url: 'https://upload.example.test/1',
      bytes: bytesOf('png'),
      mediaType: 'image/png',
      onProgress: () => undefined,
      fetchFn,
    })

    handle.abort()
    await expect(handle.done).rejects.toThrow('aborted')
  })
})

describe('putImageOf', () => {
  test('hands storeImage a put that carries the media type through', async () => {
    const seen: string[] = []
    const fetchFn = (async (input: Parameters<typeof fetch>[0]) => {
      seen.push(String(input))
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const put = putImageOf((args) => putBytes({ ...args, fetchFn }))

    await put({
      url: 'https://upload.example.test/1',
      bytes: bytesOf('png'),
      mediaType: 'image/png',
      onProgress: () => undefined,
    }).done

    expect(seen).toEqual(['https://upload.example.test/1'])
  })
})
