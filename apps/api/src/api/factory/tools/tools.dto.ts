import { IsNotEmpty, IsString, MaxLength } from 'class-validator'

const TOOL_BODY_CAP = 10_000

export class LinearCommentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(TOOL_BODY_CAP)
  body!: string
}

export class LinearSetStateDto {
  @IsString()
  @IsNotEmpty()
  stateName!: string
}

export class LinearMarkDuplicateDto {
  @IsString()
  @IsNotEmpty()
  duplicateOfId!: string
}

export class GithubCloseIssueDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(TOOL_BODY_CAP)
  body!: string
}

export class GithubLabelDto {
  @IsString()
  @IsNotEmpty()
  label!: string
}
