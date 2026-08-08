import { apiContract, apiErrorResponseSchema, type ApiInfoResponse } from './contract'

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ReturnType<typeof apiErrorResponseSchema.parse>
  ) {
    super(body.error.message)
    this.name = 'ApiClientError'
  }
}

/** A fetch-only client safe to import from either browser application. */
export class ApiClient {
  constructor(
    private readonly baseUrl = '',
    private readonly fetchImplementation: typeof fetch = fetch
  ) {}

  async getInfo(): Promise<ApiInfoResponse> {
    return this.request(apiContract.info.path, apiContract.info.response)
  }

  private async request<T>(path: string, responseSchema: { parse(value: unknown): T }): Promise<T> {
    const response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
      headers: { accept: 'application/json' }
    })
    const payload: unknown = await response.json()
    if (!response.ok) {
      throw new ApiClientError(response.status, apiErrorResponseSchema.parse(payload))
    }
    return responseSchema.parse(payload)
  }
}
