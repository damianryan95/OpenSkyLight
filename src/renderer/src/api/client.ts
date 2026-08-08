import type { IpcChannel, IpcContract, IpcResult } from '@shared/ipc/contract'
import { browserInvoke, browserSubscribe } from './browser'

export class IpcError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
    this.name = 'IpcError'
  }
}

export async function ipcInvoke<K extends IpcChannel>(
  channel: K,
  req: IpcContract[K]['req']
): Promise<IpcContract[K]['res']> {
  if (window.osl === undefined) return browserInvoke(channel, req)
  const result = (await window.osl.invoke(channel, req)) as IpcResult<IpcContract[K]['res']>
  if (!result.ok) throw new IpcError(result.error.code, result.error.message)
  return result.data
}

/** Subscribe to a renderer push channel in either supported host. */
export function subscribePush(channel: string, callback: (data: unknown) => void): () => void {
  return window.osl === undefined ? browserSubscribe(channel, callback) : window.osl.on(channel, callback)
}
