# Requirements Document

## Introduction

This feature adds the ability to hide message content in desktop notifications (macOS and Windows) for the ZaDark extension of Zalo PC. When enabled, notifications will display placeholder text instead of actual message content, protecting user privacy when notifications appear on screen. The feature integrates with ZaDark's existing settings panel and follows the established patterns for privacy-related toggles.

## Glossary

- **ZaDark**: A dark mode extension for Zalo that also provides privacy features
- **Zalo PC**: The desktop application for Zalo messaging on macOS and Windows
- **Notification Window**: A separate Electron BrowserWindow (`znotification.html`) that displays incoming message notifications
- **Main App Window**: The primary Zalo application window where users interact with messages
- **Settings Panel**: The ZaDark popup menu accessible via the ZaDark button in the left sidebar
- **Privacy Toggle**: A switch control that enables/disables a privacy feature
- **Notification Content**: The message body text displayed in the notification popup (`#zbody` element)
- **Notification Sender**: The name of the person/group who sent the message (`#zname` element)
- **Notification Avatar**: The profile picture shown in the notification (`#zavatar` element)

## Requirements

### Requirement 1

**User Story:** As a Zalo user, I want to hide message content in notifications, so that people nearby cannot read my private messages when notifications appear.

#### Acceptance Criteria

1. WHEN the user enables the "Hide Notification Content" toggle THEN the System SHALL replace notification message text with placeholder dots (••••••)
2. WHEN the user disables the "Hide Notification Content" toggle THEN the System SHALL display the actual message content in notifications
3. WHEN the setting is enabled and a new notification appears THEN the System SHALL apply the content hiding immediately without requiring app restart
4. THE System SHALL persist the "Hide Notification Content" setting across app restarts

### Requirement 2

**User Story:** As a Zalo user, I want to access the notification privacy setting from the ZaDark settings panel, so that I can easily configure it alongside other privacy options.

#### Acceptance Criteria

1. THE System SHALL display a "Hide Notification Content" toggle in the ZaDark settings panel
2. THE System SHALL place the toggle in the privacy settings section alongside existing privacy toggles (Hide Latest Message, Hide Conversation Avatar, etc.)
3. WHEN the user hovers over the help icon next to the toggle THEN the System SHALL display a tooltip explaining the feature
4. THE System SHALL display the toggle with Vietnamese label "Ẩn nội dung thông báo"

### Requirement 3

**User Story:** As a Zalo user, I want the notification privacy setting to work on both macOS and Windows, so that I have consistent privacy protection regardless of my operating system.

#### Acceptance Criteria

1. WHEN running on macOS THEN the System SHALL hide notification content in macOS notification popups
2. WHEN running on Windows THEN the System SHALL hide notification content in Windows notification popups
3. THE System SHALL use the same setting value for both platforms without requiring separate configuration

### Requirement 4

**User Story:** As a Zalo user, I want to optionally hide the sender name in notifications, so that I have additional privacy control over what information is visible.

#### Acceptance Criteria

1. WHEN the user enables the "Hide Notification Sender" toggle THEN the System SHALL replace the sender name with placeholder dots (••••••)
2. WHEN the user disables the "Hide Notification Sender" toggle THEN the System SHALL display the actual sender name in notifications
3. THE System SHALL allow independent control of content hiding and sender hiding
4. THE System SHALL persist the "Hide Notification Sender" setting across app restarts

### Requirement 5

**User Story:** As a Zalo user, I want keyboard shortcuts to quickly toggle notification privacy settings, so that I can enable privacy mode rapidly when needed.

#### Acceptance Criteria

1. WHEN the user presses Ctrl+8 (Windows) or ⌘8 (macOS) THEN the System SHALL toggle the "Hide Notification Content" setting
2. WHEN the keyboard shortcut is used THEN the System SHALL display a toast notification confirming the setting change
3. WHEN the "Use Hotkeys" setting is disabled THEN the System SHALL ignore the keyboard shortcut
