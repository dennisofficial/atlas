import { json, type RequestHandler } from 'express'

/**
 * Sanity caps for the unauthenticated webhook endpoints, raw bytes over the wire. The global
 * JSON parser accepts WORKSPACE_BODY_LIMIT (96mb) because workspace pushes are legitimately
 * large; a GitHub or Linear webhook delivery is never anywhere near that, and these routes are
 * reachable with no caller principal (the HMAC is verified only after the body is buffered), so
 * they get their own parsers that reject oversized bodies before buffering.
 */
export const GITHUB_WEBHOOK_BODY_LIMIT = '1mb'
export const LINEAR_WEBHOOK_BODY_LIMIT = '256kb'

/** Mounted per-route in main.ts; mirrors the global parser's verify hook so `request.rawBody` is set. */
export function webhookJsonParser(args: { limit: string }): RequestHandler {
  return json({
    limit: args.limit,
    verify: (request, _response, buffer) => {
      ;(request as { rawBody?: Buffer }).rawBody = buffer
    },
  })
}

/**
 * Per-minute request cap for the unauthenticated webhook endpoints, applied in place of
 * @SkipThrottle(). Real GitHub/Linear senders deliver at most a few events a second and retry
 * on 429, while an attacker spraying invalid signatures has no throttle at all without this.
 */
export const WEBHOOK_THROTTLE_PER_MINUTE = 60
