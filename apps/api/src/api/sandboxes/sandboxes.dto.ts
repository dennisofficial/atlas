import { Type } from 'class-transformer'
import {
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
}

export class AttachSandboxDto {
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
  skillsBundle?: string
}
