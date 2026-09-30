import { Type } from 'class-transformer'
import {
  IsBoolean,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator'

const whenGiven = () => ValidateIf((_object: unknown, value: unknown) => value !== null)

export class GitIdentityDto {
  @IsString()
  name!: string

  @IsString()
  email!: string
}

export class WorkspaceSpecDto {
  @whenGiven()
  @IsString()
  remoteUrl!: string | null

  @whenGiven()
  @IsString()
  branch!: string | null

  @whenGiven()
  @IsString()
  commit!: string | null

  @IsString()
  patch!: string

  @IsOptional()
  @IsString()
  projectDirectory?: string | null

  @IsOptional()
  @ValidateNested()
  @Type(() => GitIdentityDto)
  gitIdentity?: GitIdentityDto | null
}

export class RegisterSandboxMetadataDto {
  @IsOptional()
  @IsString()
  title?: string

  @IsOptional()
  @IsString()
  repo?: string

  @IsOptional()
  @IsString()
  model?: string
}

export class ClaimSandboxDto {
  @IsString()
  @IsNotEmpty()
  threadId!: string

  @IsOptional()
  @IsString()
  @MinLength(64)
  clientToken?: string

  @IsOptional()
  @IsString()
  serveUrl?: string

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RegisterSandboxMetadataDto)
  metadata?: RegisterSandboxMetadataDto

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => WorkspaceSpecDto)
  workspace?: WorkspaceSpecDto

  @IsOptional()
  @IsString()
  contextBundle?: string

  @IsOptional()
  @IsString()
  gitToken?: string

  @IsOptional()
  @IsString()
  gpgKey?: string

  @IsOptional()
  @IsString()
  @MinLength(1)
  driveName?: string | null

  @IsOptional()
  @IsBoolean()
  contextPending?: boolean
}
