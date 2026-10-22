import { Resend } from 'resend'

export interface IEmailMessage {
  to: string | string[]
  subject: string
  html: string
  text: string
}

export type EmailSender = (message: IEmailMessage) => Promise<{ id: string }>

export class EmailError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number | null,
  ) {
    super(message)
    this.name = 'EmailError'
  }
}

export function createEmailSender({ apiKey, from }: { apiKey: string; from: string }): EmailSender {
  const resend = new Resend(apiKey)

  return async (message) => {
    const { data, error } = await resend.emails.send({ from, ...message })
    if (error) {
      throw new EmailError(`Resend refused the message: ${error.message}`, error.name, error.statusCode)
    }
    return { id: data.id }
  }
}
