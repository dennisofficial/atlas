import { IsNotEmpty, IsString, MaxLength } from 'class-validator'

const BODY_MAX_LENGTH = 60_000

export class CreateReplyDto {
  @IsString()
  @IsNotEmpty()
  surface!: string

  @IsString()
  @IsNotEmpty()
  externalId!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(BODY_MAX_LENGTH)
  body!: string
}
