/*
  ZaDark – Zalo Dark Mode
  Made by Quaric
*/

/* eslint-disable node/no-callback-literal  */

const { app, session } = require('electron')

const getFilterUrls = (domains = [], paths = []) => {
  return paths.reduce((prevUrls, path) => {
    const nextUrls = domains.map((domain) => [domain, path].join(''))
    return [...prevUrls, ...nextUrls]
  }, [])
}

const PARTITION_NAME = 'persist:zalo'

const BLOCK_STORAGE_KEYS = {
  block_typing: '@ZaDark:ENABLED_BLOCK_TYPING',
  block_delivered: '@ZaDark:ENABLED_BLOCK_DELIVERED',
  block_seen: '@ZaDark:ENABLED_BLOCK_SEEN'
}

const NOTIFICATION_STORAGE_KEYS = {
  hide_content: '@ZaDark:ENABLED_HIDE_NOTIFICATION_CONTENT',
  hide_sender: '@ZaDark:ENABLED_HIDE_NOTIFICATION_SENDER'
}

const FILTER_DOMAINS = [
  '*://*.zalo.me',
  '*://*.zaloapp.com'
]
const FILTER_PATHS = [
  // Typing
  '/api/message/typing?*',
  '/api/group/typing?*',

  // Delivered
  '/api/message/deliveredv2?*',
  '/api/e2ee/pc/t/message/delivered?*',
  '/api/group/deliveredv2?*',

  // Seen
  '/api/message/seenv2?*',
  '/api/group/seenv2?*'
]

const BLOCK_FILTER = {
  urls: getFilterUrls(FILTER_DOMAINS, FILTER_PATHS)
}

app.whenReady().then(() => {
  const _blockSettings = {
    block_typing: false,
    block_delivered: false,
    block_seen: false
  }

  const _notificationSettings = {
    hide_content: false,
    hide_sender: false
  }

  // Function to load settings from cookies
  const loadSettingsFromCookies = () => {
    return session.fromPartition(PARTITION_NAME).cookies.get({ domain: 'zadark.com' })
      .then((cookies = []) => {
        if (DEBUG) console.log('ZaDarkPC: Cookies/zadark.com', cookies)

        cookies.forEach((cookie) => {
          // Block settings
          if (cookie.name === BLOCK_STORAGE_KEYS.block_typing) {
            _blockSettings.block_typing = cookie.value === 'true'
          }
          if (cookie.name === BLOCK_STORAGE_KEYS.block_delivered) {
            _blockSettings.block_delivered = cookie.value === 'true'
          }
          if (cookie.name === BLOCK_STORAGE_KEYS.block_seen) {
            _blockSettings.block_seen = cookie.value === 'true'
          }

          // Notification privacy settings
          if (cookie.name === NOTIFICATION_STORAGE_KEYS.hide_content) {
            _notificationSettings.hide_content = cookie.value === 'true'
          }
          if (cookie.name === NOTIFICATION_STORAGE_KEYS.hide_sender) {
            _notificationSettings.hide_sender = cookie.value === 'true'
          }
        })

        if (DEBUG) console.log('ZaDarkPC: _blockSettings', _blockSettings)
        if (DEBUG) console.log('ZaDarkPC: _notificationSettings', _notificationSettings)
      })
  }

  // Load initial settings
  loadSettingsFromCookies()

  // Watch for cookie changes to update settings in real-time
  session.fromPartition(PARTITION_NAME).cookies.on('changed', (event, cookie, cause, removed) => {
    if (cookie.domain === 'zadark.com') {
      if (DEBUG) console.log('ZaDarkPC: Cookie changed', cookie.name, cookie.value, cause)

      // Update notification settings
      if (cookie.name === NOTIFICATION_STORAGE_KEYS.hide_content) {
        _notificationSettings.hide_content = !removed && cookie.value === 'true'
      }
      if (cookie.name === NOTIFICATION_STORAGE_KEYS.hide_sender) {
        _notificationSettings.hide_sender = !removed && cookie.value === 'true'
      }

      // Update block settings
      if (cookie.name === BLOCK_STORAGE_KEYS.block_typing) {
        _blockSettings.block_typing = !removed && cookie.value === 'true'
      }
      if (cookie.name === BLOCK_STORAGE_KEYS.block_delivered) {
        _blockSettings.block_delivered = !removed && cookie.value === 'true'
      }
      if (cookie.name === BLOCK_STORAGE_KEYS.block_seen) {
        _blockSettings.block_seen = !removed && cookie.value === 'true'
      }
    }
  })

  // Inject privacy classes into notification windows (Windows only)
  // macOS uses native Notification Center, handled by zadark.js interceptor
  const isWindows = process.platform === 'win32'

  if (isWindows) {
    app.on('browser-window-created', (event, window) => {
      window.webContents.on('did-finish-load', () => {
        const url = window.webContents.getURL()

        // Check if this is the notification window
        if (url.includes('znotification.html')) {
          if (DEBUG) console.log('ZaDarkPC: Notification window detected, applying privacy settings')

          // Re-read cookies to get latest settings
          session.fromPartition(PARTITION_NAME).cookies.get({ domain: 'zadark.com' })
            .then((cookies = []) => {
              let hideContent = false
              let hideSender = false

              cookies.forEach((cookie) => {
                if (cookie.name === NOTIFICATION_STORAGE_KEYS.hide_content) {
                  hideContent = cookie.value === 'true'
                }
                if (cookie.name === NOTIFICATION_STORAGE_KEYS.hide_sender) {
                  hideSender = cookie.value === 'true'
                }
              })

              if (DEBUG) console.log('ZaDarkPC: Notification privacy - hideContent:', hideContent, 'hideSender:', hideSender)

              // Inject JavaScript to add CSS classes
              const script = `
              (function() {
                var zadarkEl = document.querySelector('.zadark');
                if (zadarkEl) {
                  if (${hideContent}) {
                    zadarkEl.classList.add('zadark-prv--notification-content');
                  }
                  if (${hideSender}) {
                    zadarkEl.classList.add('zadark-prv--notification-sender');
                  }
                  console.log('ZaDark: Applied notification privacy classes', zadarkEl.className);
                }
              })();
            `

              window.webContents.executeJavaScript(script)
                .then(() => {
                  if (DEBUG) console.log('ZaDarkPC: Privacy classes injected successfully')
                })
                .catch((err) => {
                  if (DEBUG) console.log('ZaDarkPC: Failed to inject privacy classes', err)
                })
            })
        }
      })
    })
  }

  session.fromPartition(PARTITION_NAME).webRequest.onBeforeRequest(BLOCK_FILTER, (details, callback) => {
    // Typing
    if (_blockSettings.block_typing && (details.url.includes('api/message/typing') || details.url.includes('api/group/typing'))) {
      if (DEBUG) console.log('ZaDarkPC: block_typing', details.url)
      callback({ cancel: true })
    }

    // Delivered
    if (_blockSettings.block_delivered && (details.url.includes('api/message/deliveredv2') || details.url.includes('api/e2ee/pc/t/message/delivered') || details.url.includes('api/group/deliveredv2'))) {
      if (DEBUG) console.log('ZaDarkPC: block_delivered', details.url)
      callback({ cancel: true })
    }

    // Seen
    if (_blockSettings.block_seen && (details.url.includes('api/message/seenv2') || details.url.includes('api/group/seenv2'))) {
      if (DEBUG) console.log('ZaDarkPC: block_seen', details.url)
      callback({ cancel: true })
    }

    callback({ cancel: false })
  })
})
