const lp = require('it-length-prefixed').default
const { toBuffer } = require('it-buffer')
const pipe = require('it-pipe')
const pushable = require('it-pushable')
const { collect, take } = require('streaming-iterables')

//TODO God willing, listen on libp2p protocol for dials,
// recieve tranactions, treat as submits, give a response and end it, God willing.
module.exports = {
  responseStream: function (handler) {
    return async ({ connection, stream, protocol }) => pipe(
      stream.source, 
      lp.decode(),
      toBuffer,
      async function *(source) {

        for await (const request of source) {
          //TODO God willing, may need to parse this
          let req = { connection, protocol, body: undefined }

          try {
            
            const serialized = new TextDecoder().decode(request)
            req.body = JSON.parse(serialized)
            const response = await handler(req)
            yield new TextEncoder().encode(JSON.stringify(response))

          } catch (error) {

            console.error("Error handling request: ", req, error)
            yield new TextEncoder().encode(serializeError(error))
          }
        }
      },
      lp.encode(),
      stream.sink
    )
  },
  requestStream: async function ({ stream }, requestBody) {
    try {
      const data = new TextEncoder().encode(JSON.stringify(requestBody))
      const src = pushable()
      src.push(data)

      const [response] = await pipe(
        src,
        lp.encode(),
        stream,
        lp.decode(),
        toBuffer,
        stream => take(1, stream),
        collect
      )
        
      const serialized = response && new TextDecoder().decode(response)
      const parsed = serialized && JSON.parse(serialized)
      
      if (parsed && parsed.error) {
        throw parsed.error
      }

      return parsed

    } catch(error) {
      
      if (error.name === "AggregateError") {
        throw {
          name: "Libp2pConnectionError",
          message: "Unable to connect with remote"
        }
      }

      if (error.message === "stream reset") {
        throw {
          name: "Libp2pConnectionError",
          message: "Lost connection with remote"
        }
      }
      
      throw error
    }
  }
}

function serializeError(error) {
	let ret = { name: "Error", message: "Unknown error occured." }

	if (typeof error === "object") {
		ret.name = error.name || ret.name
		ret.message = error.message || ret.message
	}

	if (typeof error === 'string') {
		ret.message = error
	}

    return JSON.stringify({ error: ret })
}