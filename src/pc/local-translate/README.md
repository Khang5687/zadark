# ZaDark Local Translate Backend

Desktop local translation backend owned by ZaDark. End users should not install
or launch a separate server.

Run a mock backend:

```sh
ZADARK_LOCAL_TRANSLATE_MOCK=1 node src/pc/local-translate/backend.js
```

Translate:

```sh
curl -s http://127.0.0.1:5555/v1/translate \
  -H 'content-type: application/json' \
  -d '{"text":"hello","source":"en","target":"vi","convId":"demo","context":["previous message"]}'
```

Status:

```sh
curl -s 'http://127.0.0.1:5555/v1/local-translate/status?storagePath=/tmp/zadark-models'
```

Delete a downloaded model:

```sh
curl -s http://127.0.0.1:5555/v1/local-translate/delete-model \
  -H 'content-type: application/json' \
  -d '{"variantId":"desktop-llamacpp-translategemma-4b-q4","storagePath":"/tmp/zadark-models"}'
```

The manifest supports two download styles:

- Hugging Face snapshots with `downloadKind: "hf-snapshot"` and `modelRef`.
- Single artifacts with `modelUrl` and optional `sha256`.

The MLX TranslateGemma variant downloads its model snapshot directly with Node.
It does not require `uv`, `huggingface-cli`, or Python tooling for the download.
Production model URLs and Hugging Face revisions are pinned so upstream changes
cannot silently replace an installed model.

TranslateGemma use is subject to the Gemma terms and prohibited-use policy.
`GEMMA_NOTICE.txt` is packaged with the backend, and the setup action links to
both documents before download.

The llama.cpp variant uses `llama-chat-template.jinja` so `source: "auto"` and
bounded conversation context work without changing the downloaded GGUF.

On Apple Silicon, ZaDark uses an existing MLX runtime when available and
otherwise installs the official llama.cpp Metal runtime. End users do not need
Python, `uv`, or a separate server application.

Windows x64 uses the official llama.cpp CPU runtime as the reliable baseline.
GPU-specific Windows runtimes are not selected until launch fallback is
implemented.

Intel macOS and Linux x64 use pinned official llama.cpp CPU runtimes.

Runtime binaries are separate from model files. ZaDark looks for runtimes in
its writable data directory first, then falls back to commands already on PATH:

- `~/.zadark/local-translate/runtimes/mlx-macos-arm64/bin/python3` for MLX on
  Apple Silicon.
- `~/.zadark/local-translate/runtimes/llama.cpp/bin/llama-server` for llama.cpp
  fallback.

If a variant declares a runtime artifact, `/local-translate/install` downloads
it before the model:

- `runtimeUrl`: artifact URL.
- `runtimeArchiveUrl`: `.tar`, `.tar.gz`, or `.zip` artifact URL extracted under
  the writable local translation data directory.
- `runtimeSha256`: optional checksum.
- `runtimeArchiveSha256`: optional archive checksum.
- `runtimeEstimatedBytes`: optional disk/progress estimate.
- `runtimePath`: optional path under `runtimes/`; otherwise the first bundled
  runtime candidate is used.

If a runtime is missing, status reports `runtimeAvailable: false` so the UI can
avoid starting a broken translation flow.

The heavy model runtime starts on demand and is stopped after the idle timeout
(`ZADARK_LOCAL_TRANSLATE_IDLE_MS`, default 15 minutes). The backend itself is a
thin in-app local API. Its model runtime uses a random private high port per app
launch to reduce collisions with other local software.
