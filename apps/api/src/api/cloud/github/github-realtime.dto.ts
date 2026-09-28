import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator'

/**
 * Exactly one of `prNumber` / `branch`: a linked PR subscribes by number, the tracked checkout
 * by branch. Zero or both is a 400, not an ambiguous read.
 */
function ExactlyOneTarget(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'exactlyOneTarget',
      target: object.constructor,
      propertyName,
      ...(validationOptions === undefined ? {} : { options: validationOptions }),
      validator: {
        validate(_value: unknown, args: ValidationArguments) {
          const body = args.object as { prNumber?: number; branch?: string }
          return (body.prNumber === undefined) !== (body.branch === undefined)
        },
        defaultMessage: () => 'exactly one of prNumber or branch is required',
      },
    })
  }
}

export class SubscribeDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[^/\s]+\/[^/\s]+$/, { message: 'repoFullName must be owner/repo' })
  repoFullName!: string

  @IsOptional()
  @IsInt()
  @IsPositive()
  prNumber?: number

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @ExactlyOneTarget()
  branch?: string
}
