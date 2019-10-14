const withPeerMutex = require('./with-peer-mutex')

const OneHour = 1000 * 60 * 60

module.exports = ({ ipfs, mutexManager, peersPath, getPeerPath, getPeerInfo, syndicate }) => {
  return async (options) => {
    options = options || {}

    const since = Date.now() - OneHour
    let filter = options.filter

    if (!filter) {
      const { id } = await ipfs.id()

      filter = peerInfo => {
        if (peerInfo.isFriend) return true
        if (peerInfo.id === id) return true
        if (!peerInfo.lastSeenAt) return false
        return peerInfo.lastSeenAt >= since
      }
    }

    let files
    try {
      files = await ipfs.files.ls(peersPath)
    } catch (err) {
      if (err.code === 'ERR_NOT_FOUND' || err.message.includes('does not exist')) {
        files = []
      } else {
        throw err
      }
    }

    const maybeCollect = withPeerMutex(mutexManager, async peerId => {
      const peerInfo = await getPeerInfo(peerId)

      if (!filter(peerInfo)) {
        await ipfs.files.rm(getPeerPath(peerId), { recursive: true })
        syndicate.publish({ action: 'remove', id: peerId })
      }
    }, 'writeLock')

    for (const { name } of files) {
      await maybeCollect(name)
    }
  }
}