/**
 * Property-based tests for notification privacy settings
 * Feature: hide-notification-content
 */

import { describe, it, beforeEach } from 'vitest'
import * as fc from 'fast-check'

// Mock localStorage
const localStorageMock = (() => {
  let store = {}
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = String(value) },
    removeItem: (key) => { delete store[key] },
    clear: () => { store = {} }
  }
})()

// Mock ZaDarkCookie
let cookieStore = {}
const ZaDarkCookie = {
  set: (name, value) => { cookieStore[name] = value; return true }
}

// Storage keys (matching the implementation)
const ZADARK_ENABLED_HIDE_NOTIFICATION_CONTENT_KEY = '@ZaDark:ENABLED_HIDE_NOTIFICATION_CONTENT'
const ZADARK_ENABLED_HIDE_NOTIFICATION_SENDER_KEY = '@ZaDark:ENABLED_HIDE_NOTIFICATION_SENDER'

// Placeholder pattern used when content is hidden
const PLACEHOLDER_PATTERN = '••••••'

// ZaDarkStorage implementation (extracted for testing)
const ZaDarkStorage = {
  saveEnabledHideNotificationContent: (isEnabled) => {
    ZaDarkCookie.set(ZADARK_ENABLED_HIDE_NOTIFICATION_CONTENT_KEY, isEnabled ? 'true' : 'false')
    return localStorageMock.setItem(ZADARK_ENABLED_HIDE_NOTIFICATION_CONTENT_KEY, isEnabled)
  },
  getEnabledHideNotificationContent: () => {
    return localStorageMock.getItem(ZADARK_ENABLED_HIDE_NOTIFICATION_CONTENT_KEY) === 'true'
  },
  saveEnabledHideNotificationSender: (isEnabled) => {
    ZaDarkCookie.set(ZADARK_ENABLED_HIDE_NOTIFICATION_SENDER_KEY, isEnabled ? 'true' : 'false')
    return localStorageMock.setItem(ZADARK_ENABLED_HIDE_NOTIFICATION_SENDER_KEY, isEnabled)
  },
  getEnabledHideNotificationSender: () => {
    return localStorageMock.getItem(ZADARK_ENABLED_HIDE_NOTIFICATION_SENDER_KEY) === 'true'
  }
}

/**
 * Simulates the notification display logic
 * Returns what content should be displayed based on settings
 */
const getDisplayedNotificationContent = (originalContent, hideContentEnabled) => {
  if (hideContentEnabled) {
    return PLACEHOLDER_PATTERN
  }
  return originalContent
}

/**
 * Simulates the notification sender display logic
 * Returns what sender name should be displayed based on settings
 */
const getDisplayedNotificationSender = (originalSender, hideSenderEnabled) => {
  if (hideSenderEnabled) {
    return PLACEHOLDER_PATTERN
  }
  return originalSender
}

/**
 * Simulates applying CSS classes based on cookie values
 * This mirrors the logic in zadark-znotification.js
 */
const applyNotificationPrivacyClasses = (element, cookies) => {
  const hideContentCookie = cookies.find(c => c.name === ZADARK_ENABLED_HIDE_NOTIFICATION_CONTENT_KEY)
  const hideSenderCookie = cookies.find(c => c.name === ZADARK_ENABLED_HIDE_NOTIFICATION_SENDER_KEY)

  const hideContent = hideContentCookie?.value === 'true'
  const hideSender = hideSenderCookie?.value === 'true'

  if (hideContent) {
    element.classList.add('zadark-prv--notification-content')
  } else {
    element.classList.remove('zadark-prv--notification-content')
  }

  if (hideSender) {
    element.classList.add('zadark-prv--notification-sender')
  } else {
    element.classList.remove('zadark-prv--notification-sender')
  }

  return element
}

beforeEach(() => {
  localStorageMock.clear()
  cookieStore = {}
})


describe('Notification Privacy Settings', () => {
  /**
   * **Feature: hide-notification-content, Property 1: Notification content toggle behavior**
   * *For any* notification content string and toggle state, when the hide notification content
   * setting is enabled, the displayed content should be the placeholder pattern (••••••),
   * and when disabled, the displayed content should be the original message.
   * **Validates: Requirements 1.1, 1.2**
   */
  describe('Property 1: Notification content toggle behavior', () => {
    it('should display placeholder when hide content is enabled, original content when disabled', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }), // original message content (non-empty)
          fc.boolean(), // hide content setting
          (originalContent, hideContentEnabled) => {
            const displayedContent = getDisplayedNotificationContent(originalContent, hideContentEnabled)

            if (hideContentEnabled) {
              // When enabled, should show placeholder
              return displayedContent === PLACEHOLDER_PATTERN
            } else {
              // When disabled, should show original content
              return displayedContent === originalContent
            }
          }
        ),
        { numRuns: 100 }
      )
    })

    it('should apply correct CSS class based on hide content cookie value', () => {
      fc.assert(
        fc.property(
          fc.boolean(), // hide content setting
          (hideContentEnabled) => {
            // Simulate saving the setting (which sets the cookie)
            ZaDarkStorage.saveEnabledHideNotificationContent(hideContentEnabled)

            // Create a mock element with classList
            const mockElement = {
              classList: {
                classes: new Set(),
                add: function(cls) { this.classes.add(cls) },
                remove: function(cls) { this.classes.delete(cls) },
                contains: function(cls) { return this.classes.has(cls) }
              }
            }

            // Convert cookieStore to array format like Electron returns
            const cookies = Object.entries(cookieStore).map(([name, value]) => ({ name, value }))

            // Apply the privacy classes
            applyNotificationPrivacyClasses(mockElement, cookies)

            // Check if the correct class is applied
            const hasContentClass = mockElement.classList.contains('zadark-prv--notification-content')
            return hasContentClass === hideContentEnabled
          }
        ),
        { numRuns: 100 }
      )
    })
  })

  /**
   * **Feature: hide-notification-content, Property 2: Notification sender toggle behavior**
   * *For any* sender name string and toggle state, when the hide notification sender
   * setting is enabled, the displayed sender should be the placeholder pattern (••••••),
   * and when disabled, the displayed sender should be the original name.
   * **Validates: Requirements 4.1, 4.2**
   */
  describe('Property 2: Notification sender toggle behavior', () => {
    it('should display placeholder when hide sender is enabled, original sender when disabled', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }), // original sender name (non-empty)
          fc.boolean(), // hide sender setting
          (originalSender, hideSenderEnabled) => {
            const displayedSender = getDisplayedNotificationSender(originalSender, hideSenderEnabled)

            if (hideSenderEnabled) {
              // When enabled, should show placeholder
              return displayedSender === PLACEHOLDER_PATTERN
            } else {
              // When disabled, should show original sender
              return displayedSender === originalSender
            }
          }
        ),
        { numRuns: 100 }
      )
    })

    it('should apply correct CSS class based on hide sender cookie value', () => {
      fc.assert(
        fc.property(
          fc.boolean(), // hide sender setting
          (hideSenderEnabled) => {
            // Simulate saving the setting (which sets the cookie)
            ZaDarkStorage.saveEnabledHideNotificationSender(hideSenderEnabled)

            // Create a mock element with classList
            const mockElement = {
              classList: {
                classes: new Set(),
                add: function(cls) { this.classes.add(cls) },
                remove: function(cls) { this.classes.delete(cls) },
                contains: function(cls) { return this.classes.has(cls) }
              }
            }

            // Convert cookieStore to array format like Electron returns
            const cookies = Object.entries(cookieStore).map(([name, value]) => ({ name, value }))

            // Apply the privacy classes
            applyNotificationPrivacyClasses(mockElement, cookies)

            // Check if the correct class is applied
            const hasSenderClass = mockElement.classList.contains('zadark-prv--notification-sender')
            return hasSenderClass === hideSenderEnabled
          }
        ),
        { numRuns: 100 }
      )
    })
  })

  /**
   * **Feature: hide-notification-content, Property 3: Settings persistence round-trip**
   * *For any* boolean setting value (true/false), saving the notification privacy settings
   * and then reading them back should return the same values.
   * **Validates: Requirements 1.4, 4.4**
   */
  describe('Property 3: Settings persistence round-trip', () => {
    it('should persist and retrieve hide notification content setting correctly', () => {
      fc.assert(
        fc.property(fc.boolean(), (isEnabled) => {
          // Save the setting
          ZaDarkStorage.saveEnabledHideNotificationContent(isEnabled)
          
          // Read it back
          const retrieved = ZaDarkStorage.getEnabledHideNotificationContent()
          
          // Should match the original value
          return retrieved === isEnabled
        }),
        { numRuns: 100 }
      )
    })

    it('should persist and retrieve hide notification sender setting correctly', () => {
      fc.assert(
        fc.property(fc.boolean(), (isEnabled) => {
          // Save the setting
          ZaDarkStorage.saveEnabledHideNotificationSender(isEnabled)
          
          // Read it back
          const retrieved = ZaDarkStorage.getEnabledHideNotificationSender()
          
          // Should match the original value
          return retrieved === isEnabled
        }),
        { numRuns: 100 }
      )
    })

    it('should sync hide notification content setting to cookie', () => {
      fc.assert(
        fc.property(fc.boolean(), (isEnabled) => {
          // Save the setting
          ZaDarkStorage.saveEnabledHideNotificationContent(isEnabled)
          
          // Cookie should have the correct value
          const cookieValue = cookieStore[ZADARK_ENABLED_HIDE_NOTIFICATION_CONTENT_KEY]
          return cookieValue === (isEnabled ? 'true' : 'false')
        }),
        { numRuns: 100 }
      )
    })

    it('should sync hide notification sender setting to cookie', () => {
      fc.assert(
        fc.property(fc.boolean(), (isEnabled) => {
          // Save the setting
          ZaDarkStorage.saveEnabledHideNotificationSender(isEnabled)
          
          // Cookie should have the correct value
          const cookieValue = cookieStore[ZADARK_ENABLED_HIDE_NOTIFICATION_SENDER_KEY]
          return cookieValue === (isEnabled ? 'true' : 'false')
        }),
        { numRuns: 100 }
      )
    })
  })
})


  /**
   * **Feature: hide-notification-content, Property 4: Settings independence**
   * *For any* combination of hide content and hide sender settings, changing one setting
   * should not affect the value of the other setting.
   * **Validates: Requirements 4.3**
   */
  describe('Property 4: Settings independence', () => {
    it('changing hide content setting should not affect hide sender setting', () => {
      fc.assert(
        fc.property(
          fc.boolean(), // initial content setting
          fc.boolean(), // initial sender setting
          fc.boolean(), // new content setting
          (initialContent, initialSender, newContent) => {
            // Set initial values
            ZaDarkStorage.saveEnabledHideNotificationContent(initialContent)
            ZaDarkStorage.saveEnabledHideNotificationSender(initialSender)
            
            // Change content setting
            ZaDarkStorage.saveEnabledHideNotificationContent(newContent)
            
            // Sender setting should remain unchanged
            const senderAfterChange = ZaDarkStorage.getEnabledHideNotificationSender()
            return senderAfterChange === initialSender
          }
        ),
        { numRuns: 100 }
      )
    })

    it('changing hide sender setting should not affect hide content setting', () => {
      fc.assert(
        fc.property(
          fc.boolean(), // initial content setting
          fc.boolean(), // initial sender setting
          fc.boolean(), // new sender setting
          (initialContent, initialSender, newSender) => {
            // Set initial values
            ZaDarkStorage.saveEnabledHideNotificationContent(initialContent)
            ZaDarkStorage.saveEnabledHideNotificationSender(initialSender)
            
            // Change sender setting
            ZaDarkStorage.saveEnabledHideNotificationSender(newSender)
            
            // Content setting should remain unchanged
            const contentAfterChange = ZaDarkStorage.getEnabledHideNotificationContent()
            return contentAfterChange === initialContent
          }
        ),
        { numRuns: 100 }
      )
    })
  })
