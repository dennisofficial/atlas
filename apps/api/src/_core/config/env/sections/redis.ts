import Joi from 'joi'

export interface IRedisEnv {
  REDIS_URL?: string
}

export const redisEnvSchema = {
  REDIS_URL: Joi.string()
    .pattern(/^rediss?:\/\//)
    .optional(),
}
