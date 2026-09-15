import { SetMetadata } from '@nestjs/common'

export const MIN_CLIENT_VERSION_KEY = 'minClientVersion'

export const MinClientVersion = (minimum: string) => SetMetadata(MIN_CLIENT_VERSION_KEY, minimum)
