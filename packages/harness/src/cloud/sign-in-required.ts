export class CloudSignInRequiredError extends Error {
  constructor() {
    super('sign in to Atlas Cloud first — /auth')
    this.name = 'CloudSignInRequiredError'
  }
}
