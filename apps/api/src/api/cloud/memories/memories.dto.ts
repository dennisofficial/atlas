import { Transform } from 'class-transformer'
import { IsIn, IsInt, IsString, Matches, MaxLength, Min, MinLength, ValidateIf } from 'class-validator'
import {
  EMemoryScope,
  EMemoryType,
  MAX_MEMORY_BODY_CHARS,
  MAX_MEMORY_DESCRIPTION_CHARS,
  MEMORY_NAME_PATTERN,
  MEMORY_PROJECT_PATTERN,
} from '@dltech/atlas-wire'

const lowercased = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.toLowerCase() : value

export class MemoryProjectQuery {
  @ValidateIf((_, value: unknown) => value !== undefined)
  @Transform(lowercased)
  @Matches(MEMORY_PROJECT_PATTERN)
  project?: string
}

export class MemoryKeyDto extends MemoryProjectQuery {
  @IsIn(Object.values(EMemoryScope))
  scope!: EMemoryScope

  @Matches(MEMORY_NAME_PATTERN)
  name!: string
}

export class PutMemoryDto extends MemoryKeyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_MEMORY_DESCRIPTION_CHARS)
  description!: string

  @IsIn(Object.values(EMemoryType))
  type!: EMemoryType

  @IsString()
  @MaxLength(MAX_MEMORY_BODY_CHARS)
  body!: string
}

export class EditMemoryDto extends MemoryKeyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_MEMORY_BODY_CHARS)
  old!: string

  @IsString()
  @MaxLength(MAX_MEMORY_BODY_CHARS)
  new!: string

  @IsInt()
  @Min(1)
  revision!: number
}
