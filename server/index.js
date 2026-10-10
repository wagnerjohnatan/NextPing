import express from 'express'
import { createServer } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'

const app = express()
const server = createServer(app)
const webSocketServer = new WebSocketServer({ server, path: '/test' })
const port = Number(process.env.PORT) || 3001
const chunkSize = 128 * 1024
const chunkCount = 8
const downloadChunk = Buffer.alloc(chunkSize, 1)

app.get('/health', (_request, response) => {
  response.json({ status: 'ok', service: 'nextping-test-node' })
})

webSocketServer.on('connection', (socket) => {
  let uploadedBytes = 0

  socket.on('message', (data, isBinary) => {
    if (isBinary) {
      uploadedBytes += data.length
      if (uploadedBytes >= chunkSize * chunkCount) {
        uploadedBytes = 0
        socket.send(JSON.stringify({ type: 'upload-complete' }))
      }
      return
    }

    let message
    try {
      message = JSON.parse(data.toString())
    } catch {
      socket.close(1003, 'Invalid message')
      return
    }

    if (message.type === 'ping' && Number.isInteger(message.id)) {
      socket.send(JSON.stringify({ type: 'pong', id: message.id }))
      return
    }

    if (message.type === 'download') {
      let remaining = chunkCount
      const sendChunk = () => {
        if (socket.readyState !== WebSocket.OPEN) return
        if (remaining === 0) {
          socket.send(JSON.stringify({ type: 'download-complete' }))
          return
        }

        remaining -= 1
        socket.send(downloadChunk, (error) => {
          if (error) {
            socket.terminate()
            return
          }
          sendChunk()
        })
      }
      sendChunk()
    }
  })
})

server.listen(port, () => {
  console.log(`NEXTPING test node listening on http://localhost:${port}`)
})
