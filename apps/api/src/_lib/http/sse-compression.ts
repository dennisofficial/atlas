import compression from 'compression'
import type { RequestHandler } from 'express'

const EVENT_STREAM = 'text/event-stream'
const SSE_THRESHOLD_BYTES = 0
const BROTLI = 'br'

const asText = (value: number | string | string[] | undefined): string =>
  Array.isArray(value) ? value.join(', ') : String(value ?? '')

export const isEventStream = (contentType: number | string | string[] | undefined): boolean =>
  asText(contentType).startsWith(EVENT_STREAM)

// compression negotiates br ahead of gzip (PREFERRED_ENCODING in compression/index.js) and brotli
// at its default quality holds a chunk back until it fills a block, which stalls an event stream
// behind a slow link. Dropping br from the request leaves gzip, which flushes on res.flush().
const withoutBrotli = (accept: string): string =>
  accept
    .split(',')
    .filter((entry) => entry.split(';')[0]?.trim().toLowerCase() !== BROTLI)
    .join(',')

export const sseCompression = (): RequestHandler =>
  compression({
    threshold: SSE_THRESHOLD_BYTES,
    filter: (request, response) => {
      if (!isEventStream(response.getHeader('content-type'))) return false
      const accept = request.headers['accept-encoding']
      if (accept !== undefined) request.headers['accept-encoding'] = withoutBrotli(accept)
      return true
    },
  })
