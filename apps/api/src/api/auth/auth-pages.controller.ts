import { Controller, Get, Header, VERSION_NEUTRAL } from '@nestjs/common'
import { Public } from '@core/decorators/public.decorator'
import { DEVICE_PAGE, SIGN_IN_PAGE, SIGN_UP_PAGE } from './auth-pages.html'

@Public()
@Controller({ version: VERSION_NEUTRAL })
export class AuthPagesController {
  @Get('sign-up')
  @Header('content-type', 'text/html; charset=utf-8')
  handleSignUpPage(): string {
    return SIGN_UP_PAGE
  }

  @Get('sign-in')
  @Header('content-type', 'text/html; charset=utf-8')
  handleSignInPage(): string {
    return SIGN_IN_PAGE
  }

  @Get('device')
  @Header('content-type', 'text/html; charset=utf-8')
  handleDevicePage(): string {
    return DEVICE_PAGE
  }
}
