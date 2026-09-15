import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { HEADERS_METADATA } from '@nestjs/common/constants'
import { AuthPagesController } from './auth-pages.controller'

const controller = new AuthPagesController()

const headersOf = (handler: (...args: never[]) => unknown): Record<string, string> =>
  Object.fromEntries(
    (Reflect.getMetadata(HEADERS_METADATA, handler) as { name: string; value: string }[]).map(
      (header) => [header.name, header.value],
    ),
  )

const handlers = [
  ['sign-up', controller.handleSignUpPage],
  ['sign-in', controller.handleSignInPage],
  ['device', controller.handleDevicePage],
] as const

describe('AuthPagesController', () => {
  it.each(handlers)('serves the %s page as html with the inline-script CSP', (_name, handler) => {
    const headers = headersOf(handler)

    expect(headers['content-type']).toContain('text/html')
    expect(headers['content-security-policy']).toContain("script-src 'unsafe-inline'")
  })

  it.each(handlers)('renders the %s page', (_name, handler) => {
    expect(handler.call(controller)).toContain('<!doctype html>')
  })

  it('redirects a signed-out device visit to sign-in by reading the session body', () => {
    const page = controller.handleDevicePage()

    expect(page).toContain("fetch('/api/auth/get-session')")
    expect(page).toContain('!session.user')
    expect(page).toContain("window.location.href = '/sign-in?next='")
    expect(page).not.toContain('You need to sign in first.')
  })

  it('shows an error instead of hanging when the session fetch fails', () => {
    const page = controller.handleDevicePage()

    expect(page).toContain('.catch(() => {')
    expect(page).toContain('Could not reach Atlas Cloud')
  })
})
