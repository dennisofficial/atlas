import { Type } from 'class-transformer'
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator'

export class SupervisedAgentInput {
  @IsString()
  @IsNotEmpty()
  spawnedBy!: string

  @IsString()
  @IsNotEmpty()
  type!: string
}

export class EventDraftDto {
  @IsString()
  @IsNotEmpty()
  type!: string

  @IsString()
  body!: string

  @IsOptional()
  @IsString()
  contextSlot?: string

  @IsOptional()
  @IsString()
  contextKey?: string

  @IsOptional()
  @IsString()
  contextDigest?: string
}

export class CreateThreadDto {
  @IsOptional()
  @IsString()
  title?: string

  @IsOptional()
  @IsString()
  workspace?: string

  @IsOptional()
  @IsString()
  repo?: string | null

  @IsOptional()
  @ValidateNested()
  @Type(() => SupervisedAgentInput)
  agent?: SupervisedAgentInput
}

export class OpenThreadDto {
  @IsOptional()
  @IsString()
  threadId?: string

  @IsString()
  @IsNotEmpty()
  runId!: string

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => EventDraftDto)
  drafts!: EventDraftDto[]

  @IsOptional()
  @IsString()
  title?: string

  @IsOptional()
  @IsString()
  workspace?: string

  @IsOptional()
  @IsString()
  repo?: string | null

  @IsOptional()
  @IsString()
  executionLocation?: string

  @IsOptional()
  @ValidateNested()
  @Type(() => SupervisedAgentInput)
  agent?: SupervisedAgentInput
}

export class AppendEventsDto {
  @IsString()
  @IsNotEmpty()
  runId!: string

  @IsOptional()
  @IsString()
  parentRunId?: string

  @IsOptional()
  @IsInt()
  @Min(0)
  depth?: number

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => EventDraftDto)
  drafts!: EventDraftDto[]
}

export class RenameThreadDto {
  @IsString()
  title!: string
}

export class ChooseModelDto {
  @IsString()
  @IsNotEmpty()
  ref!: string

  @IsString()
  @IsNotEmpty()
  effort!: string
}

export class ChooseLocationDto {
  @IsString()
  @IsNotEmpty()
  location!: string
}

export class AdoptThreadDto {
  @IsString()
  @IsNotEmpty()
  workspace!: string

  @IsOptional()
  @IsString()
  repo!: string | null
}

export class RewindThreadDto {
  @IsInt()
  @Min(0)
  toSeq!: number

  @IsOptional()
  @IsString({ each: true })
  cutAgents?: string[]
}

export class CompactThreadDto {
  @IsIn(['prefix', 'suffix'])
  anchor!: string

  @IsInt()
  @Min(0)
  fromSeq!: number

  @IsInt()
  @Min(0)
  throughSeq!: number

  @IsString()
  summary!: string
}

export class SummariseThreadDto extends CompactThreadDto {
  @IsOptional()
  @IsString({ each: true })
  cutAgents?: string[]
}

export class ForkThreadDto {
  @IsInt()
  @Min(0)
  seq!: number

  @IsIn(['reference', 'copy'])
  mode!: string

  @IsOptional()
  @IsString()
  title?: string
}

export class RecordTurnDto {
  @IsString()
  @IsNotEmpty()
  status!: string

  @IsString()
  @IsNotEmpty()
  providerId!: string

  @IsString()
  @IsNotEmpty()
  modelId!: string

  @IsInt()
  @Min(0)
  steps!: number

  @IsInt()
  @Min(0)
  inputTokens!: number

  @IsInt()
  @Min(0)
  outputTokens!: number

  @IsInt()
  @Min(0)
  cacheReadTokens!: number

  @IsInt()
  @Min(0)
  cacheWriteTokens!: number

  @IsString()
  @IsNotEmpty()
  startedAt!: string

  @IsString()
  @IsNotEmpty()
  endedAt!: string

  @IsInt()
  @Min(0)
  durationMs!: number
}
