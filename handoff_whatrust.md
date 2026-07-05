# WhatRust Local Translation Handoff

Status: living handoff, started 2026-07-05.

Audience: a future agent or maintainer implementing a similar local translation
feature in WhatRust, a Rust WhatsApp desktop app. WhatRust is not ZaDark; carry
over the product constraints and safety model, not the Electron-specific wiring.

Subagent note: one maintainer-perspective subagent was requested with
`gpt-5.5-medium`. The CLI runner rejected that exact model name, but the
multi-agent tool accepted the equivalent `gpt-5.5` with medium reasoning. The
subagent response is folded into this handoff.

## Quick Answer: Commit Count

The ZaDark local translation implementation work before this handoff spans 54
commits, from:

- `91bd6bc feat(pc): add local translate backend prototype`
- through `1c55f48 feat(pc): download translation model in background`

## Purpose

ZaDark now has a local desktop translation path:

- User clicks translate on a message.
- If no model is installed, ZaDark asks for consent and disk confirmation.
- Model/runtime download happens only after opt-in.
- Translation runs locally on the user's machine.
- The model runtime starts on demand and stops after an idle timeout.
- Users can see progress and delete model files from settings.

The purpose of this document is to help WhatRust implement a similar feature
without inheriting ZaDark's Electron-specific constraints or current rough edges.

## Target WhatRust Repo

Repo checked on 2026-07-05:

- Path: `/Users/khangnguyen/working/projects/whatRust`
- Remote: `https://github.com/Khang5687/whatRust.git`
- Branch: `master`
- Stack: Tauri 2 + Rust 1.82 + plain settings UI files under `settings-ui/`.
- Product name: `whatRust`, app id `com.karem.whatrust`.
- Bundles: `deb`, `appimage`, `app`, `dmg`, `nsis`, `msi`.

Relevant existing files:

- Rust app entry: `src-tauri/src/lib.rs`
- Tauri commands: `src-tauri/src/commands.rs`
- Settings persistence: `src-tauri/src/settings.rs`
- WhatsApp page bridge: `src-tauri/resources/bridge.js`
- Settings UI: `settings-ui/index.html`, `settings-ui/main.js`,
  `settings-ui/style.css`
- Tauri config: `src-tauri/tauri.conf.json`

Important repo-specific constraints:

- WhatsApp windows have labels like `wa-<id>` and are treated as remote/untrusted.
- Settings/account commands reject remote WhatsApp windows via `is_remote()`.
- Translation control commands should follow that pattern: trusted settings
  window can manage install/settings; WhatsApp windows should only get the
  smallest command surface needed for translating selected message text.
- Settings already use `app.path().app_config_dir()`; model/runtime data should
  use Tauri app data/cache dirs, not a new hardcoded dotdir.
- The app already has notification/tray plugins, so background download progress
  can be surfaced through existing settings/tray patterns before adding anything
  heavier.

## ZaDark Implementation Summary

### Product Behavior

- Translation is per-message from the existing translate button.
- Source language is treated as automatic by prompt/model behavior.
- Target language is user-selected in settings.
- The local model is not downloaded until the user asks to translate and accepts
  model terms.
- First-use dialog shows:
  - local/private explanation
  - model download size
  - current free disk and estimated free disk after download
  - Gemma terms checkbox
  - disk usage visualization
- After consent, download continues in the background.
- During download, Translate settings shows status and a progress bar.
- Re-clicking translate while downloading returns a non-blocking message instead
  of reopening a blocking dialog.
- Settings include a model storage path and a delete-model button.

### Backend Shape

Main files:

- `src/pc/local-translate/backend.js`
- `src/pc/local-translate/model-manifest.json`
- `src/pc/local-translate/llama-chat-template.jinja`
- `src/pc/local-translate/GEMMA_NOTICE.txt`
- `src/pc/local-translate/README.md`
- `src/core/js/zadark-translate.js`
- `src/pc/assets/js/zadark-main.js`
- `src/pc/assets/js/zadark.js`
- `src/pc/zadark-pc.js`

ZaDark uses a thin loopback HTTP API inside Electron:

- `GET /health`
- `GET /v1/local-translate/status`
- `POST /v1/local-translate/install`
- `POST /v1/local-translate/start`
- `POST /v1/local-translate/stop`
- `POST /v1/local-translate/delete-model`
- `POST /v1/translate`

The API is local-only and intended for the app renderer, not external clients.

### Runtime Lifecycle

- Backend starts inside Zalo/Electron.
- Heavy model runtime starts only when translation is needed.
- Runtime uses a random private high port per app launch.
- Runtime stops after `ZADARK_LOCAL_TRANSLATE_IDLE_MS`, default 15 minutes.
- Runtime is also stopped on app quit.
- Runtime readiness is cached briefly to avoid repeated process checks.

### Model And Runtime Artifacts

Current production model baseline:

- Model family: TranslateGemma / Gemma.
- GGUF repo: `mradermacher/translategemma-4b-it-GGUF`.
- File: `translategemma-4b-it.Q4_K_S.gguf`.
- Revision: `35a7486e128b19642cdc72d7b91b21ba388aaf42`.
- Size: `2377945600` bytes.
- SHA-256: `95c62e1c29f977c84fe5a5d9602a91213fd03a2c7b63f2884abab2ed7b5c5f57`.

Also present as a manifest option:

- MLX snapshot repo: `mlx-community/translategemma-4b-it-4bit_immersive-translate`.
- Revision: `55fe183d44e6e1fa3e3b1eb2bb8a23f069d515c9`.
- Estimated size: `2222615758` bytes.

Current runtime baseline:

- llama.cpp release: `b9867`.
- Apple Silicon: official llama.cpp Metal archive.
- Intel macOS: official llama.cpp CPU archive.
- Windows x64: official llama.cpp CPU zip archive.
- Linux x64: official llama.cpp CPU archive.
- MLX is considered on Apple Silicon, but llama.cpp Metal is the reliable
  bundled/downloaded baseline.

Known artifact checksums live in `src/pc/local-translate/model-manifest.json`.

### Storage Layout

Default ZaDark storage:

- `~/.zadark/local-translate/models/<variant-id>/...`
- `~/.zadark/local-translate/runtimes/...`
- `~/.zadark/local-translate/runtimes/.downloads/...`

Users can override model storage path from settings.

For WhatRust, prefer Tauri app-data/cache APIs instead of hardcoded dotdirs:

- macOS: `~/Library/Application Support/WhatRust/...`
- Windows: `%APPDATA%/WhatRust/...` or the app's existing data-dir helper.
- Linux: XDG data dir.

### Download And Install

ZaDark currently supports:

- Hugging Face snapshot downloads via Node HTTP.
- Single model artifact downloads via direct URL.
- Runtime archive downloads via URL.
- `.tar`, `.tar.gz`, and `.zip` runtime extraction.
- Optional SHA-256 verification.
- Disk-space check before install.
- Model snapshot marker file for completed snapshots.
- Corrupt/missing snapshot file repair.
- Model deletion blocked while install is running.
- Gemma notice copied beside installed Gemma models.

Important safety behavior:

- Archive entries are checked for unsafe paths.
- Direct model paths are resolved under the model directory.
- Runtime binaries are installed under user data.
- Unix runtime files get executable permissions after extraction/download.

### Prompt And Context

ZaDark sends bounded per-chat context, not training data.

Current limits:

- `MAX_CONTEXT_ITEMS = 10`.
- `MAX_CONTEXT_CHARS = 4000`.
- Translation cache size: `100` entries.
- Frontend rolling memory: memory-only, keyed by current conversation id.
- Frontend rolling memory cap: about 50 messages / 8k chars per chat, 100 chats
  globally.
- llama.cpp context size flag: `-c 2048`.

Current context behavior:

- Visible messages before the selected message are collected first.
- A small per-chat memory fills gaps when older loaded messages disappear from
  the DOM.
- Context lines include speaker labels such as `[Me]`, `[Alice]`, or `[Them]`.
- Zalo-like React props such as `senderName`, `displayName`, `fromMe`, `isMe`,
  `isSelf`, and `fromUid: "0"` are used when available.
- The selected message is excluded from context.
- Own outgoing messages are marked `[Me]`.
- Images/videos without captions become short placeholders.
- Voice messages become placeholders only; ZaDark does not transcribe voice in
  this release.

Important caveat: context is heuristic. It can help disambiguate, but it is not
guaranteed. It should not be described to users as "learning" or "indexing".

### Legal And Terms Handling

Current official references checked on 2026-07-05:

- Gemma Terms: https://ai.google.dev/gemma/terms
- Gemma Prohibited Use Policy: https://ai.google.dev/gemma/prohibited_use_policy
- TranslateGemma model card: https://huggingface.co/google/translategemma-4b-it

Relevant current facts:

- Google Gemma terms were listed as last modified April 1, 2026.
- Section 3.1 requires downstream restrictions, a copy of the agreement, and a
  Notice file for distributions.
- Hugging Face lists `google/translategemma-4b-it` as `License: gemma`.
- Hugging Face says users must review and agree to Google's usage license before
  accessing the model files.

ZaDark currently does:

- Shows terms links in first-use dialog.
- Requires `acceptedGemmaTerms: true` before Gemma install API proceeds.
- Packages `GEMMA_NOTICE.txt`.
- Copies `GEMMA_NOTICE.txt` beside downloaded Gemma models.

Still not fully solved for public release:

- A real release should get legal review.
- The checkbox is useful but may not be enough by itself.
- The app may need to provide a copy of the full agreement and enforce
  prohibited-use restrictions in the app's own terms.
- If WhatRust wants the cleanest open-source path, consider requiring upstream
  Hugging Face acceptance or using a more permissive translation model.

## WhatRust Maintainer Expectations

A Rust maintainer will want a feature contract more than a ZaDark code tour.

Include:

- User-facing behavior and entry points.
- MVP versus later phases.
- Exact model/runtime artifacts.
- Disk, RAM, startup, and latency expectations.
- Supported platforms.
- Failure states:
  - no disk
  - offline
  - checksum mismatch
  - extraction failure
  - model deleted
  - runtime missing
  - runtime crash
  - translation timeout
  - terms not accepted
- What message data is sent to the local model.
- What is never sent remotely.
- What ZaDark choices are Electron-specific.
- What is known to be unfinished.

## Decisions Worth Carrying Over

Carry these forward:

- Opt-in model download only.
- Explicit model terms acceptance before download.
- Local-first privacy boundary.
- Bounded nearby context, not training/indexing.
- Runtime starts on demand.
- Idle runtime shutdown.
- User-data storage for models and runtimes.
- Checksummed downloads.
- Safe archive extraction.
- Delete-model support.
- Hardware-based runtime selection.
- Private loopback service only if HTTP is needed.
- Background download with progress in settings.
- Disk copy based on free space before/after, not percent of total disk.

## ZaDark Decisions To Reconsider For Rust

Do not blindly copy:

- Loopback HTTP. In Rust, a child process with stdin/stdout or direct library
  bindings may avoid CORS/CSP/security complexity.
- Electron CSP/CORS handling. Only relevant if WhatRust has a webview frontend.
- The 15-minute idle timeout. Tune it against WhatRust RAM pressure and model
  cold-start cost.
- MLX path. It adds packaging complexity; benchmark llama.cpp Metal first.
- Generic archive extraction. Rust should use narrow, explicit extraction code.
- UI mechanics. Carry over states, not DOM/jQuery implementation.

Recommended Rust baseline:

- Start with verified `llama.cpp` child process managed by Rust.
- Prefer direct argv process spawn over shell execution.
- Bind llama.cpp to loopback with a random port if using its HTTP server.
- If possible, add a per-session bearer token or equivalent local secret.
- Revisit linked `llama.cpp` bindings only after the child-process path works.
- In this repo, put remote-safe invocation boundaries in `commands.rs` first;
  do not let the WhatsApp page call installer/delete/settings commands.

## Suggested WhatRust Architecture

### Components

- `TranslationFeatureController`
  - decides whether translation can run
  - routes UI actions
  - owns target-language selection

- `ModelInstallManager`
  - terms acceptance
  - disk check
  - async download
  - checksum verification
  - safe extraction
  - atomic final move
  - installed manifest
  - cleanup/delete

- `RuntimeManager`
  - hardware detection
  - runtime selection
  - lazy start
  - readiness probe
  - single-flight startup lock
  - request forwarding
  - idle shutdown
  - crash restart/clear state

- `TranslationRequestBuilder`
  - source/target language handling
  - bounded context selection
  - prompt/template formatting
  - output cleanup

- `TranslationPrivacyLogger`
  - logs operational state only
  - never logs message text by default

### Rust Crates To Consider

Use project-standard crates if WhatRust already has equivalents.

Likely candidates:

- `tauri::async_runtime` first, because Tauri is already installed.
- `std::process::Command` or Tauri async process handling for child supervision.
- `reqwest` or existing HTTP client for artifact downloads/runtime calls.
- `sha2` for checksums.
- `zip`, `tar`, `flate2` only for archive formats actually shipped.
- Tauri path APIs for storage paths.
- `serde` for install/runtime manifests.

## Suggested WhatRust Implementation Phases

### Phase 1: Runtime Spike

Goal: prove the model can translate locally on one platform.

- Pick macOS Apple Silicon first if that is the maintainer machine.
- Use llama.cpp as a child process.
- Hardcode local model path.
- Send one translation request.
- Measure:
  - cold start
  - warm translation latency
  - RAM usage
  - CPU/GPU load
  - failure behavior

Skip downloader and settings UI in this phase.

### Phase 2: Runtime Manager

Goal: make process lifecycle boring.

- Lazy start.
- Health check.
- Single-flight startup.
- Request forwarding.
- Idle shutdown.
- Crash handling.
- Stop on app quit.
- No shell invocation.

### Phase 3: Installer

Goal: safe first-use model/runtime install.

- Opt-in dialog.
- Terms acceptance.
- Disk free-before/free-after check.
- Download to temp.
- Verify SHA-256.
- Extract safely.
- Move atomically into user data.
- Write installed manifest.
- Cleanup partial files.

### Phase 4: UI Integration

Goal: usable without blocking WhatsApp.

- Per-message translate entry point.
- First-use consent/download dialog.
- Background download.
- Settings progress bar.
- Delete model.
- Clear failure messages.

### Phase 5: Platform Matrix

Goal: make it reliable across supported OSes.

- macOS Apple Silicon.
- macOS Intel if supported.
- Windows x64.
- Linux x64.
- Confirm runtime executable permissions, antivirus friction, and filesystem
  locations.

### Phase 6: Hardening

Goal: release confidence.

- Archive traversal tests.
- Checksum mismatch tests.
- Disk-space tests.
- Runtime crash/restart tests.
- Install interruption tests.
- Bounded context tests.
- Speaker/own-message/media-placeholder context tests.
- Privacy/logging audit.
- Legal/terms review.

## Current ZaDark Verification Evidence

Recent checks that have passed during this work:

- `npm test`: 45 tests passing.
- `node src/pc/local-translate/backend.js --self-check`: passing.
- `standard` on touched JS files: passing.
- `npm run build`: passing, with an existing Node `fs.Stats` deprecation warning.
- Real installed Zalo app could start the local backend on loopback.
- Installed CSP now allows `http://127.0.0.1:*` and `http://localhost:*`.
- Local status endpoint returns `200` with allowed Zalo origin.
- Real model/runtime were previously downloaded and verified on this Apple
  Silicon Mac.
- A real translation returned Vietnamese output.
- Cache hit was observed on repeat translation.
- Delete model path was tested and removed model data.
- Speaker-aware context tests cover group labels, own messages as `[Me]`,
  same-chat memory isolation, selected-message exclusion, and image/voice
  placeholders.

## Known ZaDark Rough Edges

- Legal compliance is not done. The current checkbox/notice is not a substitute
  for release legal review.
- The model is large, around 2.4 GB for the current GGUF.
- Source auto-detection is prompt/model-driven, not a deterministic language ID
  pipeline.
- Context improves disambiguation only heuristically and only for messages
  currently visible or already seen during this app session.
- Voice messages are placeholders only; local ASR is intentionally deferred.
- Image understanding is deferred; current image handling is caption text or a
  placeholder.
- MLX support is present as an option but llama.cpp Metal is the practical
  baseline.
- Windows GPU support is intentionally deferred.
- The install endpoint's long-running request is used to start background
  download; the backend continues work while UI closes, but a Rust app should
  model this as an explicit background task/state machine.
- ZaDark uses HTTP/CORS/CSP because it is Electron. WhatRust should avoid that
  complexity if a native process/API path is simpler.

## Open Questions For ZaDark Before Finalizing This Feature

- Should terms acceptance be persisted with version/date, not just sent per
  install request?
- Should the app provide a full copy of the Gemma agreement, not only links and
  notice?
- Should install errors after the dialog closes surface as a toast/notification?
- Should downloads support resume, or just safe retry from scratch?
- Should there be a cancel download action?
- What are measured cold-start, warm latency, and RAM usage on each platform?
- Should Windows GPU runtimes be added after launch fallback exists?
- Should source-language detection use a small deterministic detector before
  prompting TranslateGemma?
- Should WhatRust use the same model at all, or select a more permissive model
  for easier open-source distribution?

## WhatRust Handoff Checklist

Before implementing in WhatRust, collect:

- Existing async runtime and HTTP client.
- Existing updater/asset-download mechanism.
- Supported OS/platform matrix.
- Exact per-message UI injection point in WhatsApp Web.
- How WhatRust logs errors and whether logs can contain message text.
- Whether WhatRust can ship/download executable runtimes.
- Release/legal posture for Gemma/TranslateGemma.
- Product decision: per-message only, selected text, compose-box translation, or
  auto-translate.

## Recommended First WhatRust Task

Do not start by porting ZaDark's full backend.

Start with a small Rust spike:

1. Put a known GGUF model in a local temp path.
2. Launch a verified llama.cpp binary as a child process.
3. Send one translation request.
4. Kill it after idle.
5. Measure startup, latency, memory.

Only after that works should WhatRust add downloader, terms UI, settings, and
platform packaging.
