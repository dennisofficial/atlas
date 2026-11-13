import { HttpException, type HttpExceptionOptions } from '@nestjs/common'

export class UserFacingException extends HttpException {
  constructor(message: string, status: number, options?: HttpExceptionOptions) {
    super(message, status, options)
  }
}
