import type { IAuthService } from './auth-service'

export type AuthHandler = (request: Request, pathname: string) => Promise<Response | undefined>

export function createAuthHandler({ auth }: { auth: IAuthService }): AuthHandler {
  return async (request, pathname) => {
    const { method } = request
    if (pathname === '/desktop/auth/status' && method === 'GET') {
      return Response.json(auth.status())
    }
    if (pathname === '/desktop/auth/start' && method === 'POST') {
      try {
        return Response.json(await auth.start())
      } catch (error) {
        return Response.json(
          {
            code: 'auth-start-failed',
            message: error instanceof Error ? error.message : String(error),
          },
          { status: 502 },
        )
      }
    }
    if (pathname === '/desktop/auth/sign-out' && method === 'POST') {
      await auth.signOut()
      return new Response(null, { status: 204 })
    }
    return undefined
  }
}
