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

The llama.cpp variant uses `llama-chat-template.jinja` so `source: "auto"` and
bounded conversation context work without changing the downloaded GGUF.

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
thin in-app local API.
