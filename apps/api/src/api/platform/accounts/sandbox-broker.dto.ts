import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator'

export class SandboxAccessTokenRequestDto {
  @IsString()
  @IsNotEmpty()
  provider!: string

  @IsOptional()
  @IsString()
  accountId?: string

  @IsOptional()
  @IsString()
  rejectedAccessToken?: string
}

export class SandboxSecretsRequestDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  names!: string[]
}
