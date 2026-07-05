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

The ZaDark translation implementation started at:

- `91bd6bc feat(pc): add local translate backend prototype`

The latest model/provider work is split into atomic commits:

- `09baa32 feat(pc): add local translation model manager`
- `646eac9 feat(pc): add secure cloud translation providers`
- `c73b170 feat(pc): add translation engine settings`

## Purpose

ZaDark now has a local desktop translation path:

- User clicks translate on a message.
- If no model is installed, ZaDark asks for consent and disk confirmation.
- Model/runtime download happens only after opt-in.
- Translation runs locally on the user's machine.
- The model runtime starts on demand and stops after an idle timeout.
- Users can see progress and delete model files from settings.
- TranslateGemma 4B is the default; 12B is an explicit optional download.
- Users who cannot run a local model can configure a supported cloud API.

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
- A compact ZaDark row opens a dedicated, Zalo-styled translation settings
  dialog with Local and Cloud sidebar pages. Settings include model selection,
  storage path, provider credentials, and cleanup actions.

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
- `POST /v1/translate/stream`

The API is local-only and intended for the app renderer, not external clients.

Streaming uses newline-delimited JSON over a streaming `fetch()` response.
Events are `state`, `meta`, `delta`, `done`, or `error`. The final `done` event
contains the complete translation so the UI can reconcile incremental output.
Only completed results enter the existing memory cache. ZaDark serializes model
generation, caps the queue at eight requests, propagates client cancellation to
llama.cpp, and falls back to the non-streaming endpoint on older installations.
WhatRust should use its existing native event/channel mechanism if that avoids
an Electron-style loopback streaming endpoint.

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

High-memory Apple Silicon option:

- Model: TranslateGemma 12B Q4_K_M.
- Revision: `fdf84c9f6fe14e69d58814f14e7b5b63bb6a1b28`.
- Size: `7300794112` bytes.
- SHA-256: `b7aac4b4be7ab0c49b6556c29c4467e74313df7f1e95d9f9676bb2adf0afa528`.
- ZaDark never auto-selects it. The UI recommends it only when the current
  platform and RAM meet conservative guidance; the user chooses whether to
  download and use it.

The same 4B/12B choice is exposed on Intel macOS, Windows x64, and Linux x64
using platform-compatible llama.cpp artifacts. Current advisory thresholds are
8/16 GB minimum/recommended RAM for 4B and 16/24 GB for 12B. These checks do not
block manual selection because available RAM, memory pressure, and real runtime
performance cannot be inferred reliably from total RAM alone.

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
- Wrapper message nodes such as `.chat-message.me` are also used for direction
  and sender inference when the inner `.card` lacks metadata.
- The selected message is excluded from context.
- Own outgoing messages are marked `[Me]`.
- Text extraction supports both `span-15` and newer `div-15` Zalo text nodes.
- Images/videos without captions become short placeholders.
- Voice messages become placeholders only; ZaDark does not transcribe voice in
  this release.

Important caveat: context is heuristic. It can help disambiguate, but it is not
guaranteed. It should not be described to users as "learning" or "indexing".

### Media AI

ZaDark now supports explicit, local OCR for image messages:

- Hovering a cached Zalo image exposes a "translate image text" action.
- The frontend derives the conversation and message IDs from Zalo's image
  metadata, then calls the local backend.
- `POST /v1/ocr` resolves the full cached JPEG, runs Tesseract.js with English
  and Vietnamese data, and passes the recognized text through the existing
  contextual TranslateGemma stream.
- The Tesseract.js runtime adds about 25 MB to the ZaDark PC build.
- English and Vietnamese `tessdata_fast` files are downloaded on first use,
  checksum-verified, and consume about 4.6 MB.
- OCR results are cached in memory by file path, size, and modification time.
- OCR work is serialized and capped; no media is scanned in the background.
- Settings show OCR installation size and provide a separate "Delete OCR"
  action.

WhatRust should preserve the product behavior but use its native attachment
API instead of ZaDark's filesystem resolver.

### Optional Context Footnotes

ZaDark can add book-style AI footnotes beneath a completed local translation.
The setting is enabled by default and can be disabled in Translation settings.

- Translation renders first; note generation is a separate request and cannot
  alter or delay the visible translated text.
- Superscript references appear at the end of the translation. Notes are in a
  separate block labeled `Ghi chú ngữ cảnh · AI tạo` so they cannot be mistaken
  for sender-authored content.
- The backend asks for at most two cultural events, idioms, acronyms, wordplay,
  institutions, or specialized terms.
- A conservative parser accepts only exact source phrases and rejects ordinary
  single words, fabricated phrases, whole-sentence explanations, malformed
  output, and excess notes.
- Results are cached in memory by model, target language, and source text.
- Failures are silent and never turn a successful translation into an error.
- The current TranslateGemma model still misses some valid single-word concepts
  and idioms. This is intentional: false negatives are safer than invented
  default-on explanations.

### Optional Cloud Translation

Local remains the default. Users may explicitly select OpenAI, Groq, xAI,
Mistral, OpenRouter, or a custom OpenAI-compatible endpoint. Corti is not
supported.

- There is no automatic fallback between local and cloud. A local failure must
  never silently upload a message.
- The settings UI states that selected message text and bounded recent context
  are sent to the chosen provider and that charges may apply.
- Provider, model, and endpoint are persisted by the backend. API keys are
  encrypted with Electron `safeStorage`, never returned to the renderer, and
  never stored in `localStorage`.
- Linux's insecure Electron `basic_text` storage fallback is rejected.
- Custom endpoints require HTTPS, except loopback HTTP for local development.
- Cloud errors are bounded and credential-free. Provider configuration can be
  tested and deleted from settings.
- Streaming uses the same ZaDark NDJSON event contract as local translation.
- Context footnotes remain local-only to avoid an undisclosed second paid API
  request.

WhatRust should use the platform credential store through a mature Rust/Tauri
integration rather than copying Electron `safeStorage`. Preserve the explicit
privacy boundary and never expose stored credentials to the WhatsApp webview.

Research verdict for later media features:

- Use separate specialized optional packs, not one large unified multimodal
  model.
- Voice should be a separate explicit action. First candidate: whisper.cpp plus
  a quantized Whisper large-v3-turbo model. PhoWhisper can be considered later
  as a Vietnamese-enhanced pack if testing shows normal Whisper is weak.
- Vision captioning should be later than OCR/voice. First small candidate:
  SmolVLM-256M-Instruct through ONNX Runtime.
- No voice/image model should scan all media in the background. These models
  should run only after explicit user action or a clearly labeled per-chat
  opt-in.

### ZaDark Local Media Acquisition

ZaDark has a read-only `POST /v1/local-media/resolve` endpoint. It accepts the
Zalo conversation ID, message ID, and `image` or `voice`, validates those
identifiers, and searches only Zalo's media resource directories. It does not
read encrypted message databases or trust Zalo's sometimes-stale `.rescache`
indexes.

Observed Zalo desktop contracts:

- Conversation rows expose `anim-data-id`; groups retain a `g` prefix.
- Rendered image IDs contain message, sender, and conversation IDs.
- Normal images are extensionless JPEG `_n` cache files, originals are JXL,
  and `_t` files are thumbnails.
- Voice files are extensionless mono AAC.

This filesystem contract is Zalo-specific. WhatRust should use its own message
and attachment APIs and pass bytes directly to OCR/ASR rather than porting this
resolver.

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
- 4B default with explicit, advisory 12B selection.
- No silent local-to-cloud fallback.
- OS-protected cloud credentials and an explicit remote-data disclosure.
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

- `npm test`: 75 tests passing.
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
- A 2026-07-06 non-UI integration check confirmed that a 32 GB Apple Silicon
  host can explicitly select the 12B Metal variant, find its verified GGUF and
  bundled 27 MB runtime, cold-start it, and return the corrected payment
  translation. The product default was subsequently changed back to 4B.
- Speaker-aware context tests cover group labels, own messages as `[Me]`,
  same-chat memory isolation, selected-message exclusion, and image/voice
  placeholders.
- Active model downloads are presented as a neutral pending state, with a thin
  progress bar on the main ZaDark sidebar button; they are not labeled as
  translation errors.
- Real TranslateGemma streaming was verified on Apple Silicon: the backend
  emitted startup metadata, incremental Vietnamese token deltas, and a complete
  reconciled result. A repeated request returned the cached result without
  regeneration.
- Real OCR against the cached My Documents test image returned readable English
  text with 92% confidence. The same image resolved from Zalo's cache as a full
  JPEG, and a repeat OCR request hit the in-memory cache.
- Real footnote generation returned a Vietnamese explanation for `Fourth of
  July`, suppressed an ordinary invoice sentence, and hit the memory cache on
  repeat generation.
- A packaged-app probe after installation confirmed that the loopback backend
  starts, defaults to TranslateGemma 4B, exposes 4B/12B model choices, lists
  exactly OpenAI/Groq/xAI/Mistral/OpenRouter/Custom, and never returns API key
  fields to the renderer.

### Vietnamese model benchmark

ZaDark has a reproducible 30-case product benchmark in `benchmarks/`. On a
32 GB Apple Silicon Mac, using the same llama.cpp runtime and production prompt:

- 4B Q4_K_S: 33/60 preliminary adequacy, 732 ms median, 1,373 ms p95.
- 12B Q4_K_M: 50/60 preliminary adequacy, 2,312 ms median, 4,608 ms p95.
- 12B fixed severe direction, context-copying, omitted-subject, reply-reference,
  image-context, and Tet failures. Both models still missed sarcasm.

These are one-evaluator product scores, not published benchmark claims. WhatRust
should port the cases and runner shape, then benchmark its own chosen runtime;
it should not copy ZaDark's 24 GB threshold without measuring Rust-process and
WebView memory on its supported hardware.

## Known ZaDark Rough Edges

- Legal compliance is not done. The current checkbox/notice is not a substitute
  for release legal review.
- Model storage is about 2.4 GB for 4B or 7.3 GB for the high-memory 12B option.
- Source auto-detection is prompt/model-driven, not a deterministic language ID
  pipeline.
- Context improves disambiguation only heuristically and only for messages
  currently visible or already seen during this app session.
- Voice messages are placeholders only; local ASR is intentionally deferred.
- OCR handles text in cached JPEG images. General image understanding,
  handwriting-specialized OCR, and visual captioning remain deferred.
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
