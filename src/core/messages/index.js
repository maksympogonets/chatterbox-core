const log = require('debug')('chatterbox:messages')
const Syndicate = require('../lib/syndicate')
const Peers = require('../peers')

const Messages = async ({ ipfs, mutexManager, peers, friends, config }) => {
  const getPeerPath = peerId => `${config.peersPath}/${peerId}`
  const getMessagesPath = peerId => `${getPeerPath(peerId)}/messages.json`

  const getMessagesList = peerId => {
    try {
      const data = ipfs.files.read(getMessagesPath(peerId))
      return JSON.parse(data)
    } catch (err) {
      if (err.code === 'ERR_NOT_FOUND' || err.message === 'file does not exist') {
        return []
      }
      throw err
    }
  }

  const syndicate = Syndicate()

  const read = require('./read')({ ipfs, getMessagesList, getMessagesPath, syndicate })
  const addMessage = Peers.withPeerMutex(
    mutexManager,
    require('./add')({
      ipfs,
      peers,
      friends,
      syndicate,
      getMessagesPath,
      getMessagesList,
      friendsMessageHistorySize: config.friendsMessageHistorySize
    }),
    'writeLock'
  )
  const broadcast = require('./broadcast')({
    ipfs,
    addMessage,
    broadcastTopic: config.topics.broadcast
  })

  const onBroadcastMessage = async msg => {
    const id = msg.seqno.toString('hex')
    const peerId = msg.from

    const { id: nodeId } = await ipfs.id()
    if (peerId === nodeId) return

    let chatMsg
    try {
      chatMsg = JSON.parse(msg.data)
    } catch (err) {
      return log('failed to parse %s from %s', id, peerId, msg.data, err)
    }

    try {
      await addMessage(peerId, chatMsg.text)
    } catch (err) {
      return log('failed to add message %s from %s', id, peerId, chatMsg, err)
    }
  }

  const subscribeBroadcast = () => (
    ipfs.pubsub.subscribe(config.topics.broadcast, onBroadcastMessage, {
      onError: (err, fatal) => {
        log('pubsub subscription error', err)
        if (fatal) {
          setTimeout(async function resub () {
            try {
              await subscribeBroadcast()
            } catch (err) {
              log('failed to resubscribe', err)
              setTimeout(resub, 1000)
            }
          }, 1000)
        }
      }
    })
  )

  await subscribeBroadcast()

  return {
    list: Peers.withPeerMutex(mutexManager, getMessagesList, 'readLock'),
    read: Peers.withPeerMutex(mutexManager, read, 'writeLock'),
    broadcast
  }
}

module.exports = Messages
