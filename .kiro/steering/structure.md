# ZaDark - Project Structure

```
src/
├── core/                    # Shared core code
│   ├── fonts/               # ZaDark icon fonts (TTF, WOFF, SVG)
│   ├── images/              # Shared images (logo, emoji sprite)
│   ├── js/                  # Shared JavaScript modules
│   │   ├── zadark-shared.js    # Utility functions (debounce, image conversion)
│   │   ├── zadark-translate.js # Translation feature
│   │   ├── zadark-reaction.js  # Emoji reactions
│   │   └── zadark-zconv.js     # Conversation utilities
│   └── scss/                # Shared styles
│       ├── zadark.scss         # Main dark mode styles
│       ├── zadark-popup.scss   # Settings popup styles
│       └── _*.scss             # Partials (fonts, icons, privacy, etc.)
│
├── pc/                      # Desktop application (Windows/macOS)
│   ├── index.js             # CLI entry point
│   ├── zadark-pc.js         # Core installation logic (asar manipulation)
│   ├── constants.js         # Platform-specific constants
│   ├── utils.js             # Helper functions
│   ├── assets/
│   │   ├── js/              # Runtime scripts injected into Zalo
│   │   │   ├── zadark.js       # Main runtime script
│   │   │   ├── zadark-main.js  # Electron main process injection
│   │   │   └── zadark-znotification.js # Notification styling
│   │   ├── libs/            # Bundled libraries (jQuery, etc.)
│   │   └── scss/            # PC-specific styles
│   └── packages/            # Vendored packages (ps-list)

build/pc/                    # Development build output
dist/                        # Distribution packages
tests/                       # Test files
assets/                      # Static assets (icons, emoji data)
```

## Key Patterns

### Settings Storage
- `localforage` (IndexedDB) for persistent settings

### PC Installation Flow
1. Extract Zalo's `app.asar` to temp directory
2. Copy ZaDark assets into extracted app
3. Modify `index.html`, `bootstrap.js`, `znotification.html`
4. Repack (macOS) or rename folder (Windows) as `app.asar`

### HTML Injection
`zadark-pc.js` uses `node-html-parser` to inject CSS/JS links into Zalo's HTML files and update Content-Security-Policy headers.
