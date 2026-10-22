import { beforeEach, describe, expect, it, mock, vi } from 'bun:test'

const send = vi.fn()
const constructed = vi.fn()

mock.module('resend', () => ({
  Resend: class {
    emails = { send }
    constructor(apiKey: string) {
      constructed(apiKey)
    }
  },
}))

const { createEmailSender, EmailError } = await import('./email-sender')

describe('createEmailSender', () => {
  beforeEach(() => {
    send.mockReset()
    constructed.mockReset()
  })

  it('sends from the configured address and returns the Resend id', async () => {
    send.mockResolvedValue({ data: { id: 'email_1' }, error: null })
    const sendEmail = createEmailSender({
      apiKey: 're_key',
      from: 'Atlas <noreply@mail.byatlas.io>',
    })

    const result = await sendEmail({
      to: 'delivered@resend.dev',
      subject: 'Hi',
      html: '<p>Hi</p>',
      text: 'Hi',
    })

    expect(constructed).toHaveBeenCalledWith('re_key')
    expect(send).toHaveBeenCalledWith({
      from: 'Atlas <noreply@mail.byatlas.io>',
      to: 'delivered@resend.dev',
      subject: 'Hi',
      html: '<p>Hi</p>',
      text: 'Hi',
    })
    expect(result).toEqual({ id: 'email_1' })
  })

  it('throws an EmailError carrying the Resend code and status', async () => {
    send.mockResolvedValue({
      data: null,
      error: { message: 'Invalid key', name: 'invalid_api_key', statusCode: 403 },
    })
    const sendEmail = createEmailSender({ apiKey: 're_key', from: 'a@b.c' })

    const failure = await sendEmail({ to: 'x@y.z', subject: 's', html: 'h', text: 't' }).catch(
      (e: unknown) => e,
    )

    expect(failure).toBeInstanceOf(EmailError)
    expect(failure).toMatchObject({ code: 'invalid_api_key', statusCode: 403 })
  })
})
