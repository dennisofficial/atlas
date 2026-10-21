import { IsNotEmpty, IsOptional, IsString } from 'class-validator'

export class ProvisionSandboxDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  projectId?: string
}
