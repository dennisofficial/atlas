import type { DynamicModule, Type } from '@nestjs/common'
import { Global, Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import type { ObjectSchema } from 'joi'

export interface EnvModuleOptions {
  envService: Type<unknown>
  validationSchema: ObjectSchema
}

@Global()
@Module({})
export class EnvModule {
  static forRoot({ envService, validationSchema }: EnvModuleOptions): DynamicModule {
    const isTest = process.env.NODE_ENV === 'test'

    return {
      module: EnvModule,
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validationSchema: isTest ? undefined : validationSchema,
          validationOptions: {
            allowUnknown: true,
            abortEarly: false,
          },
        }),
      ],
      providers: [envService],
      exports: [envService],
    }
  }
}
