const getPort = require('get-port')
const { promisify } = require('util')
const kill = promisify(require('tree-kill'))

module.exports = async () => {
  if (!process.env.PNPM_REGISTRY_MOCK_PORT) {
    process.env.PNPM_REGISTRY_MOCK_PORT = (await getPort({ port: getPort.makeRange(7700, 7800) })).toString()
  }
  const { start, prepare } = require('@pnpm/registry-mock')
  prepare()
  const server = start({
    // Verdaccio stopped working properly on Node.js 22.
    // You can test the issue by running:
    //   pnpm --filter=core run test test/install/auth.ts
    useNodeVersion: '20.16.0',
    stdio: 'inherit',
    // Bind the mock registry dual-stack. With a bare port, verdaccio binds
    // whatever `localhost` resolves to for it, which is ::1 on Linux but
    // 127.0.0.1 on Windows, while the test processes resolve `localhost` to
    // ::1 there — so every registry request fails with ECONNREFUSED ::1.
    listen: `[::]:${process.env.PNPM_REGISTRY_MOCK_PORT}`,
  })
  let killed = false
  server.on('error', (err) => {
    console.log(err)
  })
  server.on('close', () => {
    if (!killed) {
      console.log('Error: The registry server was killed!')
      process.exit(1)
    }
  })
  global.killServer = () => {
    killed = true
    return kill(server.pid)
  }
  // `start` only spawns verdaccio; it does not wait for it to bind. Suites that
  // hit the registry in their very first test would otherwise race the server
  // and fail with ECONNREFUSED. Wait for both loopback families to accept.
  const net = require('net')
  const port = Number(process.env.PNPM_REGISTRY_MOCK_PORT)
  const canConnect = (host) => new Promise((resolve) => {
    const socket = net.connect({ host, port })
    socket.setTimeout(2000)
    socket.on('connect', () => { socket.destroy(); resolve(true) })
    socket.on('timeout', () => { socket.destroy(); resolve(false) })
    socket.on('error', () => { socket.destroy(); resolve(false) })
  })
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    if (await canConnect('127.0.0.1') && await canConnect('::1')) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  console.log(`Warning: the registry mock did not accept connections on port ${port} within 120s`)
}
