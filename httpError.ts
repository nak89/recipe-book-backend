/** An error carrying the status the client should see. Anything else that
 *  reaches the error handler is treated as a 500 and its message is not
 *  forwarded — internal failures shouldn't describe themselves to callers. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'HttpError'
  }
}
