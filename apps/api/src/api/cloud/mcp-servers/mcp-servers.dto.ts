import { Type } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator'
import { EMcpTransportKind } from './mcp-servers.types'

export class TransportDto {
  @IsIn([EMcpTransportKind.Stdio, EMcpTransportKind.Http])
  kind!: EMcpTransportKind

  @IsOptional()
  @IsString()
  command?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  args?: string[]

  @IsOptional()
  @IsObject()
  env?: Record<string, string>

  @IsOptional()
  @IsString()
  url?: string

  @IsOptional()
  @IsObject()
  headers?: Record<string, string>
}

export class UpsertMcpServerDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => TransportDto)
  transport?: TransportDto

  @IsOptional()
  @IsBoolean()
  disabled?: boolean
}
