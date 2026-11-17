import { BadRequestException, type PipeTransform } from '@nestjs/common'
import type { z } from 'zod'

export class ZodBodyPipe<TSchema extends z.ZodType> implements PipeTransform<unknown, unknown> {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.infer<TSchema> {
    const parsed = this.schema.safeParse(value)
    if (!parsed.success) throw new BadRequestException({ reason: 'body' })
    return parsed.data
  }
}
