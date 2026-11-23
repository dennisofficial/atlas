import type { RawBodyRequest } from '@nestjs/common'
import type { Request } from 'express'

export type GithubPrWebhookRequest = RawBodyRequest<Request>
