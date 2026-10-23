import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'

export type OpenableImage = {
  path: string
  mediaType: string
  data: string | null
}

export type OpenImage = (image: OpenableImage) => boolean

export type Spawner = (command: readonly string[]) => void

const TEMP_DIRECTORY = 'atlas-images'

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
  'image/tiff': '.tiff',
  'image/heic': '.heic',
}

export function openerCommand(args: {
  platform: NodeJS.Platform
  target: string
}): readonly string[] {
  if (args.platform === 'darwin') return ['open', args.target]
  if (args.platform === 'win32') return ['cmd', '/c', 'start', '', args.target]
  return ['xdg-open', args.target]
}

const detachedSpawn: Spawner = (command) => {
  Bun.spawn([...command], { stdio: ['ignore', 'ignore', 'ignore'] }).unref()
}

function tempFileFor(args: { image: OpenableImage; data: string }): string {
  const directory = join(tmpdir(), TEMP_DIRECTORY)
  mkdirSync(directory, { recursive: true })
  const name = basename(args.image.path) || 'image'
  const extension = extname(name) === '' ? (EXTENSIONS[args.image.mediaType] ?? '') : ''
  const target = join(directory, `${name}${extension}`)
  writeFileSync(target, Buffer.from(args.data, 'base64'))
  return target
}

export function openImage(args: {
  image: OpenableImage
  spawn?: Spawner
  platform?: NodeJS.Platform
}): boolean {
  try {
    const { image } = args
    const target =
      image.path !== '' && existsSync(image.path)
        ? image.path
        : image.data === null
          ? null
          : tempFileFor({ image, data: image.data })
    if (target === null) return false
    const command = openerCommand({
      platform: args.platform ?? process.platform,
      target,
    })
    ;(args.spawn ?? detachedSpawn)(command)
    return true
  } catch {
    return false
  }
}

export const defaultOpenImage: OpenImage = (image) => openImage({ image })
