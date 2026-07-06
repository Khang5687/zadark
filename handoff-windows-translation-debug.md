# ZaDark Windows Translation Handoff

## Repository

- Git URL: <https://github.com/Khang5687/zadark.git>
- Branch: `main`
- Implementation baseline: `021da798a51350c01dbe652cf75e322262cf2afb`
- Latest release: <https://github.com/Khang5687/zadark/releases/tag/26.3.1>
- Version: `26.3.1`

```powershell
git clone https://github.com/Khang5687/zadark.git
cd zadark
git checkout main
git pull --ff-only origin main
yarn install
npm test
npm run build
```

Read `AGENTS.md` before committing or releasing. Preserve unrelated worktree changes. ZaDark releases use `YY.N` and `YY.N.PATCH`; releases are normal releases and must include all current-version binaries plus `SHA256SUMS`.

## Goal

Continue debugging and hardening local AI translation on a real Windows machine, especially an NVIDIA GeForce GTX 1650 with 4 GB VRAM. Do not require CUDA Toolkit, Python, `uv`, or a separately installed server.

Expected behavior on that machine:

- Settings remain responsive while hardware and runtime status are checked.
- Both TranslateGemma 4B and 12B are visible.
- 4B is recommended for a GTX 1650; 12B remains selectable but is labeled slower/not recommended according to system RAM.
- `Tự động`, `Chỉ dùng CPU`, `Ưu tiên CUDA`, and `Ưu tiên Vulkan` work when supported.
- CUDA is shown only for NVIDIA hardware. Vulkan is shown when available.
- Model download does not report the device as unsupported.
- Auto mode prefers CUDA when a compatible NVIDIA driver is detected, otherwise Vulkan, then CPU.
- Runtime failure falls back to CPU without losing the shared GGUF model.

## Work Completed

Release `26.3.1` addressed the reported Windows failures:

- Cached expensive PowerShell/`nvidia-smi` hardware detection for five minutes.
- Explicit `Kiểm tra lại` clears hardware and runtime caches.
- Coalesced duplicate in-flight status requests from the settings UI.
- Migrated a saved model variant from another platform/runtime to the equivalent Windows variant.
- Added explicit CUDA selection to storage, request handling, and UI.
- Filtered CUDA from non-NVIDIA machines and Vulkan from machines where it is unavailable.
- Added GTX 1650 coverage proving that both models remain available while 12B is assessed as slower.

Windows RTX 3060 Laptop validation started on 2026-07-06:

- Windows 11 IoT Enterprise LTSC 24H2 (`10.0.26100`), Ryzen 5 5600H, 32 GB RAM.
- NVIDIA GeForce RTX 3060 Laptop GPU, driver `581.83`, 6144 MiB VRAM according to `nvidia-smi`.
- CIM also reports AMD integrated graphics and a virtual display, and truncates NVIDIA `AdapterRAM` to about 4 GB. Backend detection correctly uses the 6 GB `nvidia-smi` result.
- Auto selected CUDA; explicit CUDA, Vulkan, and CPU each returned both 4B and 12B variants. The 4B model was recommended and 12B was labeled slower.
- Before the fix, initial status took 3.7 seconds and cached requests still took about 1.6 seconds. Profiling found that every variant launched PowerShell separately for disk statistics. The backend now uses native `fs.statfsSync` where available and retains the previous platform-command fallback.
- After the fix, the first Auto request took 478 ms, explicit CUDA and Vulkan took 5 ms and 4 ms, and a repeated Auto request took 4 ms. The first CPU request took 215 ms because it populated a distinct runtime probe cache.
- The focused backend suite initially exposed four Windows-only test-fixture failures: a POSIX permission assertion, two executable shell-script fixtures, and a macOS-variant download test. The permission assertion is now Unix-only and the platform-specific runtime/download fixtures are skipped on Windows.
- Backend self-check and Standard lint pass. The build passes with `$env:NODE_ENV='development'; npx gulp build`.
- The package scripts use Unix-style inline environment assignment, so `yarn build` fails under PowerShell with `NODE_ENV is not recognized`. Use the PowerShell command above until the scripts are made cross-platform.

Automated verification at handoff:

- `npm test`: 91 tests passed.
- `npm run build`: passed.
- `npm run dist`: passed.
- Release contains Windows/macOS/browser artifacts and complete checksums.

## Important Files

- `src/pc/local-translate/backend.js`: hardware detection/cache, accelerator selection, variant migration, runtime/install/fallback, and local API routes.
- `src/pc/local-translate/model-manifest.json`: pinned 4B/12B models and CPU, Vulkan, CUDA runtime archives.
- `src/pc/assets/js/zadark.js`: AI settings, model cards, accelerator selector, and status polling.
- `src/core/js/zadark-translate.js`: translation calls and persisted accelerator mode.
- `src/pc/assets/js/zadark-main.js`: bundled backend lifecycle inside Zalo/ZaDark.
- `tests/local-translate-backend.test.js`: hardware, Windows runtime, model selection, download, and fallback tests.
- `src/pc/local-translate/README.md`: architecture and storage estimates. Its accelerator description was updated after physical Windows validation to document explicit CUDA selection.

## Windows Test Procedure

Use Windows PowerShell. Record exact command output; do not rely only on the UI.

### 1. Confirm hardware tools

```powershell
nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader
Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion
```

Record whether `nvidia-smi` is on `PATH`, driver version, reported VRAM, Windows version, CPU, and system RAM.

### 2. Test the backend without Zalo UI

```powershell
$env:ZADARK_LOCAL_TRANSLATE_PORT="5557"
node src/pc/local-translate/backend.js
```

In another PowerShell window:

```powershell
Invoke-RestMethod http://127.0.0.1:5557/v1/local-translate/status
Invoke-RestMethod "http://127.0.0.1:5557/v1/local-translate/status?accelerator=cuda"
Invoke-RestMethod "http://127.0.0.1:5557/v1/local-translate/status?accelerator=vulkan"
```

Inspect `hardware`, `accelerators`, `selected`, and `variants`. Expected: NVIDIA GPU detected, `cuda` and `vulkan` offered, and one 4B plus one 12B variant returned for each supported mode.

Measure repeated status latency. The first request may run hardware commands; subsequent requests within five minutes should be fast.

### 3. Install the source build into Zalo

Close Zalo first, then run PowerShell as required by the local Zalo installation:

```powershell
npm run build
node build/pc/index.js install
```

Open Zalo, then ZaDark > `Cài đặt dịch AI`.

Test in this order:

1. Open/close and switch between local/cloud settings repeatedly; observe responsiveness.
2. Confirm 4B and 12B model cards are both present.
3. Select Auto, CUDA, Vulkan, and CPU one by one.
4. Download 4B using CUDA; confirm progress continues while the dialog is closed.
5. Translate a short message and confirm settings show the chosen runtime or a clear CPU fallback.
6. Restart Zalo and verify the model remains installed and selectable.
7. Delete only the accelerator runtime; verify the shared model remains.
8. Delete the model; verify disk usage and UI state update.

Do not download 12B merely to prove it appears. On a GTX 1650, 12B is expected to be slow and may require substantial system RAM.

## Data and Logs

Default local translation data:

```text
%USERPROFILE%\.zadark\local-translate
```

Before deleting anything, capture:

```powershell
Get-ChildItem "$env:USERPROFILE\.zadark\local-translate" -Recurse |
  Select-Object FullName,Length,LastWriteTime
```

Useful failure evidence:

- Full `/v1/local-translate/status` JSON for Auto, CUDA, and Vulkan.
- Exact toast/error text and backend console output.
- `nvidia-smi` and CIM output.
- Whether `llama-cli.exe --list-devices` succeeds in downloaded CUDA/Vulkan runtime directories.
- Downloaded file sizes and SHA-256 failures.
- Time for first and repeated settings/status loads.

Do not include private messages, API keys, or conversation context in issues or commits.

## Likely Remaining Risks

- NVIDIA driver detection depends primarily on `nvidia-smi`; test when CIM sees the GPU but `nvidia-smi` is unavailable on `PATH`.
- The pinned CUDA 12.4 runtime may reject older NVIDIA drivers. Ensure fallback is clear and does not repeatedly download or probe.
- `AdapterRAM` can be inaccurate; recommendations must remain conservative and must not hide 12B solely because VRAM reporting is wrong.
- The first hardware probe still uses synchronous commands in the backend process. It should not freeze Zalo, but measure it before adding complexity.
- Validate paths containing spaces and non-ASCII Windows usernames.
- Test interrupted downloads, low disk space, antivirus quarantine, custom/read-only model paths, runtime deletion during use, and restart during download.

## Commit Discipline

- Fix shared backend/UI paths; do not special-case the GTX 1650 model name.
- Keep 4B as default and 12B visible with honest guidance.
- Add the smallest regression test for each confirmed bug.
- Run `npm test`, `npm run build`, and the relevant distribution build before pushing.
- Do not overwrite release `26.3.1`; the next patch is `26.3.2`.
- Present Vietnamese release notes for approval before publishing.
