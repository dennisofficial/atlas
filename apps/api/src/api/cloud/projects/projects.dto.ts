import { GIT_BRANCH_PATTERN, GITHUB_REPO_PATTERN, MAX_ADDITIONAL_REPOS, MAX_PROJECT_NAME_LENGTH } from '@dltech/atlas-wire'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator'

const whenGiven = () => ValidateIf((_object: unknown, value: unknown) => value !== null)

export class ProjectRepoDto {
  @IsString()
  @Matches(GITHUB_REPO_PATTERN)
  repo!: string

  @IsOptional()
  @IsString()
  @Matches(GIT_BRANCH_PATTERN)
  branch?: string
}

export class SaveProjectDto {
  @IsString()
  @Length(1, MAX_PROJECT_NAME_LENGTH)
  name!: string

  @whenGiven()
  @IsString()
  @Matches(GITHUB_REPO_PATTERN)
  repo!: string | null

  @whenGiven()
  @IsString()
  @Matches(GIT_BRANCH_PATTERN)
  baseBranch!: string | null

  @IsArray()
  @ArrayMaxSize(MAX_ADDITIONAL_REPOS)
  @ValidateNested({ each: true })
  @Type(() => ProjectRepoDto)
  additionalRepos!: ProjectRepoDto[]
}
