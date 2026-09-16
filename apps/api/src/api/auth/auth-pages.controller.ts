import { Controller, Get, Header, VERSION_NEUTRAL } from '@nestjs/common'
import { Public } from '../../_core/decorators/public.decorator'
import { DEVICE_PAGE, SIGN_IN_PAGE, SIGN_UP_PAGE } from './auth-pages.html'

// These pages carry their behavior in inline <script> blocks, which helmet's stock
// script-src 'self' kills in the browser — the Next.js auth app is replacing them.
const INLINE_PAGE_CSP =
  "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"

@Public()
@Controller({ version: VERSION_NEUTRAL })
export class AuthPagesController {
  @Get('sign-up')
  @Header('content-type', 'text/html; charset=utf-8')
  @Header('content-security-policy', INLINE_PAGE_CSP)
  handleSignUpPage(): string {
    return SIGN_UP_PAGE
  }

  @Get('sign-in')
  @Header('content-type', 'text/html; charset=utf-8')
  @Header('content-security-policy', INLINE_PAGE_CSP)
  handleSignInPage(): string {
    return SIGN_IN_PAGE
  }

  @Get('device')
  @Header('content-type', 'text/html; charset=utf-8')
  @Header('content-security-policy', INLINE_PAGE_CSP)
  handleDevicePage(): string {
    return DEVICE_PAGE
  }
}
