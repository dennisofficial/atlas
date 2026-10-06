import { Type } from 'class-transformer'
import { IsIn, IsISO8601, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator'
import { EOauthProvider } from './oauth-connections.types'

export class GrantTokensDto {
  @IsString()
  @IsNotEmpty()
  accessToken!: string

  @IsString()
  @IsNotEmpty()
  refreshToken!: string

  @IsISO8601({ strict: true })
  expiresAt!: string

  @IsOptional()
  @IsString({ each: true })
  scopes?: string[]

  @IsOptional()
  @IsString()
  accountId?: string
}

export class UploadConnectionDto {
  @IsIn(Object.values(EOauthProvider))
  provider!: EOauthProvider

  @ValidateNested()
  @Type(() => GrantTokensDto)
  tokens!: GrantTokensDto
}

export class ReauthorizeConnectionDto extends UploadConnectionDto {
  @IsString()
  @IsNotEmpty()
  authorizationId!: string

  @IsString()
  @IsNotEmpty()
  previousAuthorizationId!: string
}

export class AccessTokenRequestDto {
  @IsOptional()
  @IsString()
  rejectedAccessToken?: string
}
