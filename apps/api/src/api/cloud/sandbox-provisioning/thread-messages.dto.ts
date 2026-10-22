import { IsString, MaxLength, MinLength } from 'class-validator'

export class ThreadMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  sendId!: string

  @IsString()
  @MinLength(1)
  @MaxLength(100_000)
  text!: string
}
