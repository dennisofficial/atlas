import { Type } from 'class-transformer'
import {
  IsBoolean,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator'

const whenGiven = () => ValidateIf((_object: unknown, value: unknown) => value !== null)

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
}

export class ClaimSandboxDto {
  @IsString()
  @IsNotEmpty()
  threadId!: string

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
  @IsBoolean()
  contextPending?: boolean
}
