import { IsNotEmpty, IsString, MaxLength } from 'class-validator'

export class PutModelDto {
  @IsString()
  @IsNotEmpty()
  apiKey!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  modelRef!: string
}

export class PutVercelDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  token!: string
}
