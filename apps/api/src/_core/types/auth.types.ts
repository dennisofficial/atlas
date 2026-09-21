import type { Request } from 'express'

export interface VerifiedSession {
  userId: string
  sessionId: string
  email: string
  activeOrganizationId: string | null
}

/**
 * Set alongside `auth` when the bearer was a sandbox session token rather than a user session:
 * `auth.userId` still names the owner (the thread-family routes key off it), but the marker is
 * what lets a handler tell a credentialed machine from the operator.
 */
export interface SandboxPrincipal {
  sandboxId: string
  threadId: string
}

export interface AuthenticatedRequest extends Request {
  auth?: VerifiedSession
  sandbox?: SandboxPrincipal
}
