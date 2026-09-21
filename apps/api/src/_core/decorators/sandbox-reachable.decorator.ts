import { SetMetadata } from '@nestjs/common'

export const SANDBOX_REACHABLE_KEY = 'atlas:sandboxReachable'

/**
 * Opts a route into sandbox-token authentication on a path that names no `:threadId`. Without it
 * the SessionOrSandboxGuard refuses a sandbox token on any threadless route, because there the
 * thread-family check has nothing to bind to and the token would otherwise authenticate as the
 * owning user at large.
 */
export const SandboxReachable = () => SetMetadata(SANDBOX_REACHABLE_KEY, true)
