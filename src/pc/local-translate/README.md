# ZaDark Local Translate Backend

Prototype backend for desktop local translation.

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

The manifest supports real model downloads with `modelUrl` and optional
`sha256`. Default URLs are intentionally empty until we choose approved model
artifact sources and distribution terms.

The heavy model runtime starts on demand and is stopped after the idle timeout
(`ZADARK_LOCAL_TRANSLATE_IDLE_MS`, default 15 minutes). The backend itself is a
thin local API intended to be owned by ZaDark, not exposed as a separate user UI.
