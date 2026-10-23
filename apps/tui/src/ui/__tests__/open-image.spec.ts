import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openerCommand, openImage } from '../open-image'

const directory = mkdtempSync(join(tmpdir(), 'atlas-open-image-'))

afterAll(() => rmSync(directory, { recursive: true, force: true }))

const BYTES = Buffer.from([1, 2, 3, 4, 5])

describe('openImage', () => {
  test('opens the path itself when it exists on this machine', () => {
    const path = join(directory, 'here.png')
    writeFileSync(path, BYTES)
    const calls: (readonly string[])[] = []

    const opened = openImage({
      image: { path, mediaType: 'image/png', data: null },
      spawn: (command) => calls.push(command),
      platform: 'darwin',
    })

    expect(opened).toBe(true)
    expect(calls).toEqual([['open', path]])
  })

  test('writes the bytes to a temp file when the path is not here', () => {
    const calls: (readonly string[])[] = []

    const opened = openImage({
      image: {
        path: '/remote/session/paste-9',
        mediaType: 'image/jpeg',
        data: BYTES.toString('base64'),
      },
      spawn: (command) => calls.push(command),
      platform: 'linux',
    })

    const target = calls[0]?.[1] ?? ''
    expect(opened).toBe(true)
    expect(calls[0]?.[0]).toBe('xdg-open')
    expect(target.startsWith(join(tmpdir(), 'atlas-images'))).toBe(true)
    expect(target.endsWith('paste-9.jpg')).toBe(true)
    expect(existsSync(target)).toBe(true)
    expect(readFileSync(target).equals(BYTES)).toBe(true)
    rmSync(target, { force: true })
  })

  test('keeps an existing extension rather than adding one', () => {
    const calls: (readonly string[])[] = []
    openImage({
      image: {
        path: '/remote/a.png',
        mediaType: 'image/png',
        data: BYTES.toString('base64'),
      },
      spawn: (command) => calls.push(command),
      platform: 'darwin',
    })
    const target = calls[0]?.[1] ?? ''
    expect(target.endsWith('a.png')).toBe(true)
    expect(target.endsWith('.png.png')).toBe(false)
    rmSync(target, { force: true })
  })

  test('returns false with neither a local path nor data', () => {
    const calls: (readonly string[])[] = []
    const opened = openImage({
      image: {
        path: '/nowhere/missing.png',
        mediaType: 'image/png',
        data: null,
      },
      spawn: (command) => calls.push(command),
    })
    expect(opened).toBe(false)
    expect(calls).toEqual([])
  })

  test('returns false when the opener cannot be launched', () => {
    const path = join(directory, 'boom.png')
    writeFileSync(path, BYTES)
    const opened = openImage({
      image: { path, mediaType: 'image/png', data: null },
      spawn: () => {
        throw new Error('ENOENT')
      },
    })
    expect(opened).toBe(false)
  })
})

describe('openerCommand', () => {
  test('maps each platform to its opener', () => {
    expect(openerCommand({ platform: 'darwin', target: '/a.png' })).toEqual(['open', '/a.png'])
    expect(openerCommand({ platform: 'linux', target: '/a.png' })).toEqual(['xdg-open', '/a.png'])
    expect(openerCommand({ platform: 'win32', target: 'C:\\a.png' })).toEqual([
      'cmd',
      '/c',
      'start',
      '',
      'C:\\a.png',
    ])
  })
})
