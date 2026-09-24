import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'

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

export class PutDecisionsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  url!: string

  @IsString()
  @IsOptional()
  @MaxLength(500)
  token?: string | undefined
}
