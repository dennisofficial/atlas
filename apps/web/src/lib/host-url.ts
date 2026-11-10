import { resolveStreamUrl } from './stream-url'

const httpOriginOf = (streamUrl: string): string => {
  const stream = new URL(streamUrl)
  stream.protocol = stream.protocol === 'wss:' ? 'https:' : 'http:'
  return stream.origin
}

export function resolveHostOrigin(env: Record<string, string | undefined>): string {
  return httpOriginOf(resolveStreamUrl(env))
}

// The bundler inlines `process.env.ATLAS_STREAM_URL` where it is named, so the browser needs these
// keys spelled out. Passing a caller's `process.env` through `resolveHostOrigin` compiles to the
// browser process shim, whose env is empty, and every agent-host call then goes to localhost:10000.
export function hostOrigin(): string {
  return resolveHostOrigin({
    ATLAS_STREAM_URL: process.env.ATLAS_STREAM_URL,
    VERCEL_ENV: process.env.VERCEL_ENV,
  })
}
