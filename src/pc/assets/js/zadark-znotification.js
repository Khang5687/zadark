/*
  ZaDark – Zalo Dark Mode
  Made by Quaric

  Note: This file is for Windows custom notification window only.
  macOS uses native Notification Center, which is handled by
  the Notification interceptor in zadark.js

  Privacy classes (zadark-prv--notification-content, zadark-prv--notification-sender)
  are injected by zadark-main.js via the main process.
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
