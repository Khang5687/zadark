/*
  ZaDark – Zalo Dark Mode
  Made by Quaric

  Note: This file is for Windows custom notification window only.
  macOS uses native Notification Center, which is handled by
  the Notification interceptor in zadark.js
*/

if (typeof require === 'function') {
  window.WebFont = require('zadark/libs/zadark-webfont.min.js')
}

document.documentElement.setAttribute('data-zadark-theme', 'dark')

WebFont.load({
  google: {
    families: ['Open Sans:400,500,600:latin,vietnamese']
  },
  timeout: 1408
})

// Storage keys for notification privacy settings
const ZADARK_ENABLED_HIDE_NOTIFICATION_CONTENT_KEY = '@ZaDark:ENABLED_HIDE_NOTIFICATION_CONTENT'
const ZADARK_ENABLED_HIDE_NOTIFICATION_SENDER_KEY = '@ZaDark:ENABLED_HIDE_NOTIFICATION_SENDER'

/**
 * Load notification privacy settings from Electron session cookies
 * and apply appropriate CSS classes to hide content/sender
 */
const loadNotificationPrivacySettings = async () => {
  try {
    let cookies = []

    // Try to get cookies via Electron's session API
    // Method 1: Zalo >= 23.7.1 uses $zelectron
    if (window.$zelectron && typeof window.$zelectron.getCookies === 'function') {
      cookies = await window.$zelectron.getCookies({ domain: 'zadark.com' }) || []
    } else if (window.electronAPI && typeof window.electronAPI.getCookies === 'function') {
      // Method 2: Zalo <= 23.6.1 uses electronAPI
      cookies = await window.electronAPI.getCookies({ domain: 'zadark.com' }) || []
    }

    // Find the privacy settings cookies
    const hideContentCookie = cookies.find(function (c) { return c.name === ZADARK_ENABLED_HIDE_NOTIFICATION_CONTENT_KEY })
    const hideSenderCookie = cookies.find(function (c) { return c.name === ZADARK_ENABLED_HIDE_NOTIFICATION_SENDER_KEY })

    const hideContent = hideContentCookie && hideContentCookie.value === 'true'
    const hideSender = hideSenderCookie && hideSenderCookie.value === 'true'

    // Get the zadark container element
    const zadarkEl = document.querySelector('.zadark')

    if (zadarkEl) {
      // Apply CSS classes based on settings
      if (hideContent) {
        zadarkEl.classList.add('zadark-prv--notification-content')
      } else {
        zadarkEl.classList.remove('zadark-prv--notification-content')
      }

      if (hideSender) {
        zadarkEl.classList.add('zadark-prv--notification-sender')
      } else {
        zadarkEl.classList.remove('zadark-prv--notification-sender')
      }
    }
  } catch (error) {
    // Log error but don't crash the notification window
    console.error('ZaDark: Failed to load notification privacy settings', error)
  }
}

// Load privacy settings when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadNotificationPrivacySettings)
} else {
  loadNotificationPrivacySettings()
}
