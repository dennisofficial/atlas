import { ConfigService } from '@nestjs/config'

type KeyOf<T> = keyof T extends never ? string | symbol : keyof T

type ValueOf<T, K extends KeyOf<T>> = K extends keyof T ? T[K] : never

export abstract class BaseEnvService<T extends object> extends ConfigService<
  T,
  true
> {
  override get<K extends KeyOf<T>>(propertyPath: K): ValueOf<T, K> {
    return super.get<ValueOf<T, K>>(propertyPath)
  }
}
