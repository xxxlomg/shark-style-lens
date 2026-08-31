import { serve, type ServerType } from '@hono/node-server'
import { createApp, type AppOptions } from './app'

export interface StartServerOptions extends AppOptions {
  port: number
  hostname?: string
}

export interface StartedServer {
  server: ServerType
  port: number
}

/** Start the loopback API and resolve only after it accepts connections. */
export function startServer(options: StartServerOptions): Promise<StartedServer> {
  const hostname = options.hostname ?? '127.0.0.1'
  const app = createApp(options)

  return new Promise((resolve, reject) => {
    const server = serve(
      { fetch: app.fetch, hostname, port: options.port },
      (info) => {
        console.log(`[StyleLens API] http://${info.address}:${info.port}`)
        resolve({ server, port: info.port })
      },
    )
    server.once('error', reject)
  })
}

/** Close the listener cleanly so the desktop process can exit without a port leak. */
export function stopServer(server: ServerType): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error?: Error) => (error ? reject(error) : resolve()))
  })
}
