# Implementation Plan

- [x] 1. Add storage layer for notification privacy settings
  - [x] 1.1 Add storage keys and methods to ZaDarkStorage in `src/pc/assets/js/zadark.js`
    - Add `ZADARK_ENABLED_HIDE_NOTIFICATION_CONTENT_KEY` constant
    - Add `ZADARK_ENABLED_HIDE_NOTIFICATION_SENDER_KEY` constant
    - Implement `saveEnabledHideNotificationContent()` method with cookie sync
    - Implement `getEnabledHideNotificationContent()` method
    - Implement `saveEnabledHideNotificationSender()` method with cookie sync
    - Implement `getEnabledHideNotificationSender()` method
    - _Requirements: 1.4, 4.4_

  - [x] 1.2 Write property test for settings persistence round-trip
    - **Property 3: Settings persistence round-trip**
    - **Validates: Requirements 1.4, 4.4**

  - [x] 1.3 Write property test for settings independence
    - **Property 4: Settings independence**
    - **Validates: Requirements 4.3**

- [x] 2. Add CSS styles for notification content hiding
  - [x] 2.1 Update `src/core/scss/zadark-znotification.scss` with privacy styles
    - Add `.zadark-prv--notification-content` class to hide `#zbody` with placeholder
    - Add `.zadark-prv--notification-sender` class to hide `#zname` with placeholder
    - Use existing CSS variable patterns for colors
    - _Requirements: 1.1, 4.1_

- [x] 3. Update notification window JavaScript
  - [x] 3.1 Enhance `src/pc/assets/js/zadark-znotification.js` to read privacy settings
    - Add function to read cookies from Electron session
    - Apply CSS classes based on cookie values
    - Add error handling for cookie access failures
    - _Requirements: 1.1, 1.2, 1.3, 3.1, 3.2, 4.1, 4.2_

  - [x] 3.2 Write property test for notification content toggle behavior
    - **Property 1: Notification content toggle behavior**
    - **Validates: Requirements 1.1, 1.2**

  - [x] 3.3 Write property test for notification sender toggle behavior
    - **Property 2: Notification sender toggle behavior**
    - **Validates: Requirements 4.1, 4.2**

- [x] 4. Add UI toggles to settings panel
  - [x] 4.1 Add toggle HTML to `popupMainHTML` in `src/pc/assets/js/zadark.js`
    - Add "Ẩn Nội dung thông báo" toggle with help tooltip
    - Add "Ẩn Người gửi thông báo" toggle with help tooltip
    - Place in privacy settings section after existing toggles
    - Add hotkey indicators (Ctrl+8/⌘8)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 4.2 Add element name constants and event handlers
    - Add `switchHideNotificationContentElName` constant
    - Add `switchHideNotificationSenderElName` constant
    - Add change event handlers for both toggles
    - _Requirements: 1.1, 1.2, 4.1, 4.2_

  - [x] 4.3 Add ZaDarkUtils update methods
    - Implement `updateHideNotificationContent()` method
    - Implement `updateHideNotificationSender()` method
    - Add toast messages for setting changes
    - _Requirements: 1.1, 1.2, 4.1, 4.2_

  - [x] 4.4 Update `loadPopupState()` to initialize toggle states
    - Load and set initial state for notification content toggle
    - Load and set initial state for notification sender toggle
    - _Requirements: 1.4, 4.4_

- [ ] 5. Add keyboard shortcuts
  - [ ] 5.1 Add hotkey bindings for notification privacy toggles
    - Add `command+8` and `ctrl+8` to hotkeys list
    - Implement handler to toggle hide notification content setting
    - Update switch state when hotkey is used
    - _Requirements: 5.1, 5.2, 5.3_

  - [ ] 5.2 Add toast messages for hotkey actions
    - Add `hideNotificationContent` messages to `HOTKEYS_TOAST_MESSAGE`
    - Add `hideNotificationSender` messages to `HOTKEYS_TOAST_MESSAGE`
    - _Requirements: 5.2_

- [ ] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Write unit tests for notification privacy feature
  - [ ] 7.1 Write unit tests for storage methods
    - Test `saveEnabledHideNotificationContent()` saves to localStorage
    - Test `getEnabledHideNotificationContent()` returns correct boolean
    - Test `saveEnabledHideNotificationSender()` saves to localStorage
    - Test `getEnabledHideNotificationSender()` returns correct boolean
    - _Requirements: 1.4, 4.4_

  - [ ] 7.2 Write unit tests for CSS class application
    - Test CSS class is added when setting is enabled
    - Test CSS class is removed when setting is disabled
    - _Requirements: 1.1, 1.2, 4.1, 4.2_

- [ ] 8. Final Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
