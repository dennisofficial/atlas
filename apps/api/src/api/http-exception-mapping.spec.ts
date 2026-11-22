import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { describe, expect, it } from 'bun:test'
import { EGithubHttpStatus, GithubHttpError } from '@dltech/atlas-github'
import { mapToHttpException } from './http-exception-mapping'

const MESSAGE = 'github said no'

const silentLog = { warn: () => undefined, error: () => undefined }

const mappedOf = (status: EGithubHttpStatus): HttpException => {
  const mapped = mapToHttpException({
    exception: new GithubHttpError({ status, message: MESSAGE }),
    log: silentLog,
  })
  expect(mapped).toBeInstanceOf(HttpException)
  return mapped as HttpException
}

const OLD_ANSWERS: ReadonlyArray<{ status: EGithubHttpStatus; was: HttpException }> = [
  { status: EGithubHttpStatus.BadRequest, was: new BadRequestException(MESSAGE) },
  { status: EGithubHttpStatus.Forbidden, was: new ForbiddenException(MESSAGE) },
  { status: EGithubHttpStatus.NotFound, was: new NotFoundException(MESSAGE) },
  { status: EGithubHttpStatus.UpgradeRequired, was: new HttpException(MESSAGE, 426) },
  { status: EGithubHttpStatus.TooManyRequests, was: new HttpException(MESSAGE, 429) },
  { status: EGithubHttpStatus.BadGateway, was: new BadGatewayException(MESSAGE) },
  { status: EGithubHttpStatus.ServiceUnavailable, was: new ServiceUnavailableException(MESSAGE) },
]

describe('mapToHttpException', () => {
  for (const { status, was } of OLD_ANSWERS) {
    it(`maps a github ${status} to the nest answer it used to throw`, () => {
      const mapped = mappedOf(status)
      expect(mapped.getStatus()).toBe(was.getStatus())
      expect(mapped.getResponse()).toEqual(was.getResponse())
      expect(mapped.message).toBe(was.message)
    })
  }

  it('maps a github http error without logging it', () => {
    const logged: unknown[] = []
    const mapped = mapToHttpException({
      exception: new GithubHttpError({ status: EGithubHttpStatus.Forbidden, message: MESSAGE }),
      log: {
        warn: (message: unknown) => logged.push(message),
        error: (message: unknown) => logged.push(message),
      },
    }) as HttpException
    expect(mapped.getStatus()).toBe(403)
    expect(logged).toEqual([])
  })
})
