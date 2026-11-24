import { BadRequestException } from '@nestjs/common'
import { UnknownModelRefError } from '@dltech/atlas-core'

export const badRequestOnUnknownModelRef = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run()
  } catch (failure) {
    if (failure instanceof UnknownModelRefError) throw new BadRequestException(failure.message)
    throw failure
  }
}
