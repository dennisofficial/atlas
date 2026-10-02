import { json, type RequestHandler } from 'express'

/**
 * Sanity cap for the unauthenticated webhook endpoints, raw bytes over the wire. The global
 * JSON parser accepts WORKSPACE_BODY_LIMIT (96mb) because workspace pushes are legitimately
 * large; a GitHub webhook delivery is never anywhere near that, and these routes are
 * reachable with no caller principal (the HMAC is verified only after the body is buffered), so
 * they get their own parser that rejects oversized bodies before buffering. There is
 * deliberately no request-rate cap here: a throttled webhook is a failed delivery, and GitHub
 * does not retry those, so the ceiling only ever dropped real events.
 */
export const GITHUB_WEBHOOK_BODY_LIMIT = '1mb'

/** Mounted per-route in main.ts; mirrors the global parser's verify hook so `request.rawBody` is set. */
export function webhookJsonParser(args: { limit: string }): RequestHandler {
  return json({
    limit: args.limit,
    verify: (request, _response, buffer) => {
      ;(request as { rawBody?: Buffer }).rawBody = buffer
    },
  })
}
