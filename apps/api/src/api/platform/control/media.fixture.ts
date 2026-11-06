import { deflateSync, inflateSync } from 'node:zlib'
import { encodePng, mediaPathname } from '@dltech/atlas-core'
import { FakeMediaStore } from '@dltech/atlas-media/testing'
import { MediaService } from './media.service'
import { sha256Hex } from './media-validation'
import { setupSessionsService } from './sessions.service.fixture'

export const pngBytes = (args: { width: number; height: number; shade?: number }): Uint8Array => {
  const rgba = new Uint8Array(args.width * args.height * 4).fill(args.shade ?? 200)
  return encodePng(
    { size: { width: args.width, height: args.height }, rgba },
    {
      inflate: (bytes) => new Uint8Array(inflateSync(bytes)),
      deflate: (bytes) => new Uint8Array(deflateSync(bytes)),
    },
  )
}

export const setupMedia = () => {
  const sessions = setupSessionsService()
  const store = new FakeMediaStore()
  const service = new MediaService(store, sessions.registry, sessions.service)
  const { service: sessionsService, ...rest } = sessions
  const upload = (args: { userId: string; bytes: Uint8Array; hash?: string }) => {
    const hash = args.hash ?? sha256Hex(args.bytes)
    const pathname = mediaPathname({ userId: args.userId, hash })
    store.put({ pathname, bytes: args.bytes })
    return { hash, pathname }
  }
  return { ...rest, sessionsService, store, service, upload }
}
