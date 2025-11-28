# ZaDark - Tech Stack

## Build System
- **Gulp** - Task runner for building, watching, and packaging
- **SCSS/Sass** - Stylesheet preprocessing
- **pkg** - Packaging Node.js apps into executables

## Languages
- JavaScript (ES6+, CommonJS modules)
- SCSS for styles
- HTML for popup/UI

## Key Dependencies
- `@electron/asar` - Extract/pack Electron app archives
- `node-html-parser` - Parse and modify HTML files
- `inquirer` - Interactive CLI prompts
- `chalk` - Terminal styling
- `fs-extra` - Enhanced file system operations
- `glob` - File pattern matching
- jQuery - DOM manipulation (bundled in assets)
- Tippy.js + Popper.js - Tooltips
- Hotkeys.js - Keyboard shortcuts
- Toastify - Toast notifications
- Intro.js - Feature tours
- WebFont - Google Fonts loader
- localforage - IndexedDB storage

## Testing
- **Vitest** - Test runner with jsdom environment
- **fast-check** - Property-based testing

## Linting
- **StandardJS** - JavaScript style guide and linter
- **Husky + lint-staged** - Pre-commit hooks

## Common Commands

```bash
# Development
yarn dev          # Build and watch for changes
yarn build        # One-time build

# Testing
yarn test         # Run tests once
yarn test:watch   # Run tests in watch mode

# Distribution
yarn dist:pc      # Build PC versions (Windows + macOS)

# PC Testing
yarn pc:dev       # Run PC version in dev mode
yarn pc:start     # Run PC version in production mode

# Linting
yarn standard:fix # Fix linting issues
```

## Build Output
- `build/pc/` - Development build
- `dist/` - Distribution packages (zip files for Windows and macOS)
