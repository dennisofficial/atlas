import { resolveStreamUrl } from './stream-url'

export function resolveHostOrigin(env: Record<string, string | undefined>): string {
  const stream = new URL(resolveStreamUrl(env))
  stream.protocol = stream.protocol === 'wss:' ? 'https:' : 'http:'
  return stream.origin
}
