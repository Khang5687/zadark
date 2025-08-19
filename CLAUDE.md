# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ZaDark is a cross-platform dark mode extension for Zalo (popular Vietnamese messaging app). The project builds browser extensions (Chrome, Firefox, Edge, Safari) and standalone PC applications (Windows, macOS) that apply dark mode styling and privacy features to Zalo.

## Commands

### Development
- `yarn dev` - Start development with file watching
- `yarn build` - Build all platforms for development 
- `yarn pc:dev` - Run PC version in development mode
- `yarn pc:start` - Run PC version in production mode

### Distribution
- `yarn dist` - Build distribution packages for all platforms
- `yarn dist:web` - Build distribution packages for web extensions only
- `yarn dist:pc` - Build distribution packages for PC apps only

Prerequisite for Chrome/Edge CRX signing (one-time):
```bash
openssl genrsa -out ./certs/privatekey.pem 2048
```

Expected outputs after `yarn dist`:
```text
dist/
  zadark[VERSION]-chrome.zip
  zadark[VERSION]-chrome.crx
  zadark[VERSION]-edge.zip
  zadark[VERSION]-firefox.zip
  zadark[VERSION]-windows.zip
  zadark[VERSION]-macos-arm64.zip
  zadark[VERSION]-macos-x64.zip
```

### Code Quality
- `yarn standard:fix` - Fix JavaScript code style issues using StandardJS

### Safari Development
- `yarn safari` - Open Safari extension project in Xcode
- `yarn safari:what-build-number` - Check current Safari build number
- `yarn safari:next-build-number` - Generate next Safari build number

## Architecture

### Multi-Platform Structure
The codebase is organized into three main directories:

- **`src/core/`** - Shared code (fonts, images, styles, utilities) used across all platforms
- **`src/web/`** - Browser extension code with platform-specific manifests and scripts
- **`src/pc/`** - Standalone PC application code for Windows and macOS

### Browser Extension Architecture
- **Platform-specific manifests**: `src/web/vendor/{chrome|firefox|edge|safari}/manifest.json`
- **Shared JavaScript modules**: Core functionality in `src/core/js/` and web-specific in `src/web/js/`
- **Blocking rules**: Privacy features using `src/web/rules/*.json` for message status blocking
- **Content scripts**: Main extension logic in `zadark.js` with popup interface

### PC Application Architecture  
- **Entry point**: `src/pc/index.js` - Interactive CLI for installing/uninstalling Zalo modifications
- **Core logic**: `zadark-pc.js` - Handles Zalo app manipulation and file modifications
- **Cross-platform support**: Detects Windows/macOS and handles platform-specific Zalo paths

### Build System
- **Gulp-based build**: `gulpfile.js` orchestrates multi-platform builds
- **SCSS compilation**: Sass files compiled to minified CSS for all platforms
- **JavaScript minification**: UglifyJS with platform-specific global variable injection
- **PKG compilation**: PC apps compiled to standalone executables using `pkg`
- **Multi-format distribution**: ZIP, CRX, and platform-specific packages

### Shared Components
- **ZaDarkShared**: Utility functions (debounce, image conversion)
- **ZaDarkUtils**: Platform abstraction layer for settings, theming, and UI
- **ZaDarkBrowser**: Browser-specific API wrapper for extensions
- **Icon fonts**: Custom ZaDark icon set with TTF/WOFF formats

## Development Notes

### File Structure Understanding
- Build outputs go to `build/` directory with platform subdirectories
- Distribution packages are created in `dist/` directory
- Core assets (fonts, icons, styles) are shared across all platforms
- Each browser has its own vendor directory with platform-specific files

Build output layout after `yarn build`:
```text
build/
  chrome/
    manifest.json
    ...
  edge/
    manifest.json
    ...
  firefox/
    manifest.json
    ...
  pc/
    package.json
    index.js
    ...
```

### Platform-Specific Considerations
- **Safari**: Requires Xcode project and separate build process
- **PC Apps**: Use Electron-style app modification rather than extension APIs  
- **Extensions**: Use manifest v2/v3 APIs with declarative net request for blocking features

### Code Standards
- Uses StandardJS for code formatting and linting
- Global variables defined in package.json for different environments
- Vietnamese language used in UI strings and comments
- DEBUG and API URL constants injected during build process

### Testing Workflow
After building (`yarn build`), test platforms by:
- **Chrome**:
  - Open `chrome://extensions/`
  - Turn on Developer Mode
  - Click "Load unpacked" and select `build/chrome/`
- **Edge**:
  - Open `edge://extensions/`
  - Turn on Developer Mode
  - Click "Load unpacked" and select `build/edge/`
- **Firefox**:
  - Open `about:debugging#/runtime/this-firefox`
  - Click "Load Temporary Add-on..." and choose `build/firefox/manifest.json`
- **Safari**:
  - Open `src/web/vendor/safari/ZaDark.xcodeproj` in Xcode
  - Choose Product > Run
  - Enable the extension in Safari: Preferences > Extensions > ZaDark for Safari
- **PC (macOS & Windows)**:
  - Development run: `yarn run pc:dev`

### Creating Built Distributions

- **Safari Extension**
  1) `yarn build`
  2) `yarn safari` or open `src/web/vendor/safari/ZaDark.xcodeproj` in Xcode
  3) Choose Product > Archive
  - Documentation: [Distributing your app for beta testing and releases](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases)

- **Chrome/Edge/Firefox/PC**
  - One-time: generate signing key pair for Chrome/Edge CRX updates:
    ```bash
    openssl genrsa -out ./certs/privatekey.pem 2048
    ```
  - Build distributables:
    ```bash
    yarn dist
    ```
  - Outputs (upload to respective stores or distribute directly for PC/macOS/Windows): see the "Expected outputs after `yarn dist`" list above.