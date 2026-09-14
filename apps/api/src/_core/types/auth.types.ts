import type { Request } from 'express'

export interface VerifiedSession {
  userId: string
  sessionId: string
  email: string
  activeOrganizationId: string | null
}

export interface AuthenticatedRequest extends Request {
  auth?: VerifiedSession
}
