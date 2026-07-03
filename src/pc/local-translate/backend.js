#!/usr/bin/env node

const assert = require('assert')
const childProcess = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const https = require('https')
const os = require('os')
const path = require('path')

const PORT = Number(process.env.ZADARK_LOCAL_TRANSLATE_PORT || 5555)
const RUNTIME_PORT = Number(process.env.ZADARK_LOCAL_TRANSLATE_RUNTIME_PORT || 5556)
const DATA_DIR = process.env.ZADARK_LOCAL_TRANSLATE_DIR || path.join(os.homedir(), '.zadark', 'local-translate')
const MAX_BODY_BYTES = 1024 * 1024
const MAX_CONTEXT_ITEMS = 10
const MAX_CONTEXT_CHARS = 4000
const TRANSLATION_CACHE_LIMIT = 100
const MANIFEST_PATH = process.env.ZADARK_LOCAL_TRANSLATE_MANIFEST || path.join(__dirname, 'model-manifest.json')
const DEFAULT_STORAGE_DIR = process.env.ZADARK_LOCAL_TRANSLATE_STORAGE_DIR || DATA_DIR
const IDLE_TIMEOUT_MS = Number(process.env.ZADARK_LOCAL_TRANSLATE_IDLE_MS || 15 * 60 * 1000)
const HF_DEFAULT_ENDPOINT = 'https://huggingface.co'
const RUNTIME_DIR = process.env.ZADARK_LOCAL_TRANSLATE_RUNTIME_DIR || path.join(DATA_DIR, 'runtimes')
const RUNTIME_STATUS_TTL_MS = Number(process.env.ZADARK_LOCAL_TRANSLATE_RUNTIME_STATUS_TTL_MS || 30 * 1000)

const state = {
  child: null,
  variant: null,
  storagePath: null,
  lastError: '',
  lastUsedAt: null,
  idleTimer: null
}
const installs = new Map()
const translationCache = new Map()
const runtimeStatusCache = new Map()

function isAllowedOrigin (origin) {
  if (!origin || origin === 'null' || origin.startsWith('file://')) return true

  try {
    const parsed = new URL(origin)
    const hostname = parsed.hostname
    return ['127.0.0.1', 'localhost', '::1'].includes(hostname) ||
      hostname === 'zalo.me' ||
      hostname.endsWith('.zalo.me') ||
      hostname === 'zaloapp.com' ||
      hostname.endsWith('.zaloapp.com')
  } catch (error) {
    return false
  }
}

function corsHeaders (req) {
  const origin = req.headers.origin
  return {
    'Content-Type': 'application/json',
    ...(origin && isAllowedOrigin(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  }
}

function json (req, res, status, body) {
  res.writeHead(status, corsHeaders(req))
  res.end(JSON.stringify(body))
}

function readJsonBody (req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
        reject(new Error('Request body is too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function loadManifest () {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
}

function parseDfOutput (output) {
  const lines = String(output).trim().split(/\r?\n/)
  const line = lines[lines.length - 1]
  const columns = line.trim().split(/\s+/)
  if (columns.length < 6) throw new Error('Unexpected df output')

  return {
    totalBytes: Number(columns[1]) * 1024,
    freeBytes: Number(columns[3]) * 1024
  }
}

function existingParent (targetPath) {
  let current = path.resolve(targetPath)
  while (!fs.existsSync(current)) {
    const next = path.dirname(current)
    if (next === current) return current
    current = next
  }
  return current
}

function getWindowsDriveName (targetPath) {
  const root = path.parse(path.resolve(targetPath)).root
  return root.replace(/[\\:]/g, '') || 'C'
}

function getDiskInfo (storagePath, estimatedBytes = 0) {
  try {
    let totalBytes
    let freeBytes

    if (os.platform() === 'win32') {
      const driveName = getWindowsDriveName(storagePath)
      const output = childProcess.execFileSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        `(Get-PSDrive -Name ${JSON.stringify(driveName)}).Used; (Get-PSDrive -Name ${JSON.stringify(driveName)}).Free`
      ], { encoding: 'utf8' })
      const values = output.trim().split(/\r?\n/).map(Number)
      totalBytes = values[0] + values[1]
      freeBytes = values[1]
    } else {
      const output = childProcess.execFileSync('df', ['-kP', existingParent(storagePath)], { encoding: 'utf8' })
      const parsed = parseDfOutput(output)
      totalBytes = parsed.totalBytes
      freeBytes = parsed.freeBytes
    }

    return {
      available: true,
      totalBytes,
      freeBytes,
      modelPercent: totalBytes ? Number(((estimatedBytes / totalBytes) * 100).toFixed(2)) : 0,
      fits: estimatedBytes <= freeBytes
    }
  } catch (error) {
    return {
      available: false,
      message: error.message
    }
  }
}

function commandExists (command) {
  if (command.includes(path.sep)) return fs.existsSync(command)

  const checker = os.platform() === 'win32' ? 'where' : 'which'
  try {
    childProcess.execFileSync(checker, [command], { stdio: 'ignore' })
    return true
  } catch (error) {
    return false
  }
}

function replaceRuntimeTokens (value) {
  return String(value).replace(/\{runtimeDir\}/g, RUNTIME_DIR)
}

function runtimeArtifactPathFor (variant) {
  if (variant.runtimePath) return path.resolve(RUNTIME_DIR, variant.runtimePath)

  const candidates = variant.runtimeCandidates || []
  return candidates
    .map(replaceRuntimeTokens)
    .find((candidate) => candidate.includes('/') || candidate.includes('\\')) || ''
}

function runtimeArchivePathFor (variant) {
  const urlPath = variant.runtimeArchiveUrl ? new URL(variant.runtimeArchiveUrl).pathname : ''
  const name = path.basename(urlPath) || `${variant.id}-runtime.tar`
  return path.join(RUNTIME_DIR, '.downloads', name)
}

function resolveRuntimeCommand (variant) {
  const candidates = (variant.runtimeCandidates && variant.runtimeCandidates.length)
    ? variant.runtimeCandidates
    : [variant.serverCommand]

  for (const candidate of candidates) {
    const command = replaceRuntimeTokens(candidate)
    if (commandExists(command)) return command
  }

  return ''
}

function validateArchiveEntries (entries) {
  const root = path.resolve(RUNTIME_DIR)
  entries.forEach((entry) => {
    const target = path.resolve(root, entry)
    if (path.isAbsolute(entry) || (target !== root && !target.startsWith(root + path.sep))) {
      throw new Error(`Refusing unsafe runtime archive path: ${entry}`)
    }
  })
}

function archiveEntriesWithTool (archivePath) {
  if (commandExists('tar')) {
    try {
      return {
        tool: 'tar',
        entries: childProcess.execFileSync('tar', ['-tf', archivePath], { encoding: 'utf8' })
          .split(/\r?\n/)
          .filter(Boolean)
      }
    } catch (error) {}
  }

  if (commandExists('unzip')) {
    return {
      tool: 'unzip',
      entries: childProcess.execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' })
        .split(/\r?\n/)
        .filter(Boolean)
    }
  }

  throw new Error('Runtime archive extractor is not available')
}

function extractRuntimeArchive (archivePath) {
  const archive = archiveEntriesWithTool(archivePath)
  validateArchiveEntries(archive.entries)
  fs.mkdirSync(RUNTIME_DIR, { recursive: true })
  if (archive.tool === 'tar') {
    childProcess.execFileSync('tar', ['-xf', archivePath, '-C', RUNTIME_DIR], { stdio: 'ignore' })
    return
  }

  childProcess.execFileSync('unzip', ['-oq', archivePath, '-d', RUNTIME_DIR], { stdio: 'ignore' })
}

function runtimeStatusCacheKey (variant) {
  return JSON.stringify({
    id: variant.id || '',
    runtime: variant.runtime || '',
    serverCommand: variant.serverCommand || '',
    runtimeCandidates: variant.runtimeCandidates || []
  })
}

function checkRuntimeStatus (variant) {
  if (!variant.serverCommand && (!variant.runtimeCandidates || !variant.runtimeCandidates.length)) {
    return { available: false, message: 'Runtime command is not configured' }
  }

  const command = resolveRuntimeCommand(variant)
  if (!command) {
    return { available: false, message: `Runtime command not found: ${variant.serverCommand || variant.runtimeCandidates[0]}` }
  }

  if (variant.runtime === 'mlx') {
    try {
      childProcess.execFileSync(command, ['-c', 'import mlx_lm.server'], { stdio: 'ignore' })
    } catch (error) {
      return { available: false, message: 'MLX runtime is not installed' }
    }
  }

  return { available: true, command, message: '' }
}

function runtimeStatus (variant) {
  const key = runtimeStatusCacheKey(variant)
  const cached = runtimeStatusCache.get(key)
  if (cached && Date.now() - cached.checkedAt < RUNTIME_STATUS_TTL_MS) return cached.value

  const value = checkRuntimeStatus(variant)
  runtimeStatusCache.set(key, { checkedAt: Date.now(), value })
  return value
}

function detectHardware () {
  const platform = os.platform()
  const arch = os.arch()
  let accelerator = 'cpu'

  if (platform === 'darwin' && arch === 'arm64') {
    accelerator = 'mlx'
  } else if (commandExists('nvidia-smi')) {
    accelerator = 'cuda'
  } else if (platform === 'win32') {
    accelerator = 'vulkan'
  }

  return {
    platform,
    arch,
    accelerator,
    totalMemGb: Math.round(os.totalmem() / 1024 / 1024 / 1024)
  }
}

function scoreVariant (variant, hardware) {
  let score = 0
  if (variant.platform === hardware.platform) score += 4
  if (variant.platform === '*') score += 1
  if (variant.arch === hardware.arch) score += 2
  if (variant.arch === '*') score += 1
  if (variant.accelerator === hardware.accelerator) score += 8
  if (variant.accelerator === 'cpu') score += 1
  return score
}

function selectVariant (manifest, requestedId) {
  if (requestedId) {
    const requested = manifest.variants.find((variant) => variant.id === requestedId)
    if (!requested) throw new Error(`Unknown model variant: ${requestedId}`)
    return requested
  }

  const hardware = detectHardware()
  const ranked = manifest.variants
    .slice()
    .sort((a, b) => scoreVariant(b, hardware) - scoreVariant(a, hardware))
  const compatible = ranked.filter((variant) => {
    return (variant.platform === '*' || variant.platform === hardware.platform) &&
      (variant.arch === '*' || variant.arch === hardware.arch)
  })
  return compatible.find((variant) => runtimeStatus(variant).available || isRuntimeDownloadable(variant)) ||
    compatible[0] ||
    ranked[0]
}

function storageRoot (storagePath) {
  return path.resolve(storagePath || DEFAULT_STORAGE_DIR)
}

function modelDirFor (variant, storagePath) {
  return path.join(storageRoot(storagePath), 'models', variant.id)
}

function modelPathFor (variant, storagePath) {
  if (variant.downloadKind === 'hf-snapshot') return modelDirFor(variant, storagePath)
  return path.join(modelDirFor(variant, storagePath), path.basename(variant.modelRef || 'model.bin'))
}

function snapshotMarkerFor (variant, storagePath) {
  return path.join(modelDirFor(variant, storagePath), '.snapshot-complete.json')
}

function snapshotInstalled (variant, storagePath) {
  const modelDir = modelDirFor(variant, storagePath)
  const markerPath = snapshotMarkerFor(variant, storagePath)
  if (!fs.existsSync(markerPath)) return false

  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'))
    if (Array.isArray(marker.filePaths) && marker.filePaths.length) {
      return marker.filePaths.every((filePath) => fs.existsSync(path.join(modelDir, filePath)))
    }
  } catch (error) {
    return false
  }

  return fs.readdirSync(modelDir).some((name) => name !== path.basename(markerPath))
}

function installKey (variant, storagePath) {
  return `${variant.id}:${storageRoot(storagePath)}`
}

function installProgressFor (variant, storagePath) {
  const install = installs.get(installKey(variant, storagePath))
  return install ? install.progress : null
}

function directorySize (targetPath) {
  if (!fs.existsSync(targetPath)) return 0
  const stat = fs.statSync(targetPath)
  if (!stat.isDirectory()) return stat.size

  return fs.readdirSync(targetPath).reduce((total, name) => {
    return total + directorySize(path.join(targetPath, name))
  }, 0)
}

function isVariantRunning (variant, storagePath) {
  return !!state.child &&
    state.variant &&
    state.variant.id === variant.id &&
    state.storagePath === storageRoot(storagePath)
}

function variantStatus (variant, storagePath) {
  const root = storageRoot(storagePath)
  const modelPath = modelPathFor(variant, root)
  const modelDir = modelDirFor(variant, root)
  const estimatedBytes = variant.estimatedBytes || 0
  const runtimeEstimatedBytes = variant.runtimeEstimatedBytes || 0
  const downloadEstimatedBytes = estimatedBytes + runtimeEstimatedBytes
  const isSnapshot = variant.downloadKind === 'hf-snapshot'
  const runtime = runtimeStatus(variant)
  const installProgress = installProgressFor(variant, root)
  return {
    id: variant.id,
    runtime: variant.runtime,
    model: variant.model,
    modelRef: variant.modelRef,
    estimatedBytes,
    runtimeEstimatedBytes,
    downloadEstimatedBytes,
    storagePath: root,
    modelPath,
    installed: isSnapshot ? snapshotInstalled(variant, root) : !!variant.modelUrl && fs.existsSync(modelPath),
    downloadable: isSnapshot || !!variant.modelUrl,
    runtimeDownloadable: isRuntimeDownloadable(variant),
    disk: getDiskInfo(root, downloadEstimatedBytes),
    usedBytes: directorySize(modelDir),
    running: isVariantRunning(variant, root),
    installing: !!installProgress,
    installProgress,
    runtimeAvailable: runtime.available,
    runtimeCommand: runtime.command || '',
    runtimeMessage: runtime.message,
    idleTimeoutMs: IDLE_TIMEOUT_MS,
    lastUsedAt: state.lastUsedAt,
    lastError: state.lastError
  }
}

function isRuntimeDownloadable (variant) {
  return (!!variant.runtimeUrl && !!runtimeArtifactPathFor(variant)) || !!variant.runtimeArchiveUrl
}

function hfEndpoint () {
  return (process.env.ZADARK_HF_ENDPOINT || HF_DEFAULT_ENDPOINT).replace(/\/$/, '')
}

function encodePathSegments (value) {
  return String(value).split('/').map(encodeURIComponent).join('/')
}

function hfApiTreeUrl (repo, revision) {
  return `${hfEndpoint()}/api/models/${encodePathSegments(repo)}/tree/${encodeURIComponent(revision || 'main')}?recursive=1`
}

function hfResolveUrl (repo, revision, filePath) {
  return `${hfEndpoint()}/${encodePathSegments(repo)}/resolve/${encodeURIComponent(revision || 'main')}/${encodePathSegments(filePath)}`
}

function getJson (url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http
    client.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        getJson(new URL(response.headers.location, url).toString()).then(resolve, reject)
        return
      }

      let raw = ''
      response.on('data', (chunk) => { raw += chunk })
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Request failed with HTTP ${response.statusCode}`))
          return
        }
        try {
          resolve(JSON.parse(raw))
        } catch (error) {
          reject(new Error('Response was not valid JSON'))
        }
      })
    }).on('error', reject)
  })
}

function downloadFile (url, destPath, expectedSha256, onProgress) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true })
    const tmpPath = destPath + '.download'
    const file = fs.createWriteStream(tmpPath)
    const hash = crypto.createHash('sha256')
    const client = url.startsWith('https:') ? https : http

    client.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close()
        fs.rmSync(tmpPath, { force: true })
        downloadFile(new URL(response.headers.location, url).toString(), destPath, expectedSha256, onProgress).then(resolve, reject)
        return
      }

      if (response.statusCode !== 200) {
        file.close()
        fs.rmSync(tmpPath, { force: true })
        reject(new Error(`Download failed with HTTP ${response.statusCode}`))
        return
      }

      response.on('data', (chunk) => {
        hash.update(chunk)
        if (onProgress) onProgress(chunk.length)
      })
      response.pipe(file)
      file.on('finish', () => {
        file.close(() => {
          const actualSha256 = hash.digest('hex')
          if (expectedSha256 && actualSha256 !== expectedSha256) {
            fs.rmSync(tmpPath, { force: true })
            reject(new Error('Downloaded model checksum mismatch'))
            return
          }
          fs.rmSync(destPath, { force: true })
          fs.renameSync(tmpPath, destPath)
          resolve({ path: destPath, sha256: actualSha256 })
        })
      })
    }).on('error', (error) => {
      file.close()
      fs.rmSync(tmpPath, { force: true })
      reject(error)
    })
  })
}

function fileSha256 (filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

async function downloadHuggingFaceSnapshot (variant, storagePath, onProgress) {
  const modelDir = modelDirFor(variant, storagePath)
  const markerPath = snapshotMarkerFor(variant, storagePath)
  if (snapshotInstalled(variant, storagePath)) return { path: modelDir, alreadyInstalled: true }

  if (!variant.modelRef) throw new Error(`Variant ${variant.id} has no Hugging Face modelRef`)

  const revision = variant.revision || 'main'
  const files = await getJson(hfApiTreeUrl(variant.modelRef, revision))
  if (!Array.isArray(files)) throw new Error('Hugging Face tree response was not a file list')

  const modelFiles = files.filter((file) => file && file.type === 'file' && file.path)
  if (!modelFiles.length) throw new Error('Hugging Face snapshot did not include any files')
  const totalBytes = modelFiles.reduce((total, file) => total + (file.size || 0), 0)
  fs.mkdirSync(modelDir, { recursive: true })
  let bytes = 0
  if (onProgress) onProgress(0, totalBytes, '')
  for (const file of modelFiles) {
    const destPath = path.resolve(modelDir, file.path)
    if (!destPath.startsWith(path.resolve(modelDir) + path.sep)) {
      throw new Error(`Refusing unsafe model path: ${file.path}`)
    }

    const expectedSha256 = file.lfs && file.lfs.oid
    if (expectedSha256 && fs.existsSync(destPath) && await fileSha256(destPath) === expectedSha256) {
      bytes += file.size || fs.statSync(destPath).size
      if (onProgress) onProgress(bytes, totalBytes, file.path)
      continue
    }

    await downloadFile(
      hfResolveUrl(variant.modelRef, revision, file.path),
      destPath,
      expectedSha256,
      (chunkBytes) => {
        bytes += chunkBytes
        if (onProgress) onProgress(bytes, totalBytes, file.path)
      }
    )
  }

  fs.writeFileSync(markerPath, JSON.stringify({
    modelRef: variant.modelRef,
    revision,
    files: modelFiles.length,
    filePaths: modelFiles.map((file) => file.path),
    bytes,
    installedAt: new Date().toISOString()
  }, null, 2))

  return { path: modelDir, files: modelFiles.length, bytes }
}

async function runInstallVariant (variant, storagePath, onProgress) {
  if (variant.downloadKind === 'hf-snapshot') {
    return downloadHuggingFaceSnapshot(variant, storagePath, onProgress)
  }

  if (!variant.modelUrl) {
    throw new Error(`Variant ${variant.id} has no modelUrl yet. Add an approved model artifact URL to the manifest.`)
  }

  const modelPath = modelPathFor(variant, storagePath)
  if (fs.existsSync(modelPath)) return { path: modelPath, alreadyInstalled: true }
  let bytes = 0
  if (onProgress) onProgress(0, variant.estimatedBytes || 0, path.basename(modelPath))
  return downloadFile(variant.modelUrl, modelPath, variant.sha256, (chunkBytes) => {
    bytes += chunkBytes
    if (onProgress) onProgress(bytes, variant.estimatedBytes || 0, path.basename(modelPath))
  })
}

async function installRuntimeVariant (variant, onProgress) {
  const runtime = runtimeStatus(variant)
  if (runtime.available) return { path: runtime.command, alreadyInstalled: true }

  if (variant.runtimeArchiveUrl) {
    const archivePath = runtimeArchivePathFor(variant)
    let bytes = 0
    if (onProgress) onProgress(0, variant.runtimeEstimatedBytes || 0, path.basename(archivePath))
    const result = await downloadFile(variant.runtimeArchiveUrl, archivePath, variant.runtimeArchiveSha256, (chunkBytes) => {
      bytes += chunkBytes
      if (onProgress) onProgress(bytes, variant.runtimeEstimatedBytes || 0, path.basename(archivePath))
    })
    extractRuntimeArchive(archivePath)
    const runtimePath = runtimeArtifactPathFor(variant)
    if (runtimePath && fs.existsSync(runtimePath) && os.platform() !== 'win32') fs.chmodSync(runtimePath, 0o755)
    fs.rmSync(archivePath, { force: true })
    runtimeStatusCache.delete(runtimeStatusCacheKey(variant))
    return { ...result, bytes }
  }

  if (!variant.runtimeUrl) return null

  const runtimePath = runtimeArtifactPathFor(variant)
  if (!runtimePath) throw new Error(`Variant ${variant.id} has no bundled runtime path`)

  let bytes = 0
  if (onProgress) onProgress(0, variant.runtimeEstimatedBytes || 0, path.basename(runtimePath))
  const result = await downloadFile(variant.runtimeUrl, runtimePath, variant.runtimeSha256, (chunkBytes) => {
    bytes += chunkBytes
    if (onProgress) onProgress(bytes, variant.runtimeEstimatedBytes || 0, path.basename(runtimePath))
  })
  if (os.platform() !== 'win32') fs.chmodSync(runtimePath, 0o755)
  runtimeStatusCache.delete(runtimeStatusCacheKey(variant))
  return { ...result, bytes }
}

async function installVariant (variant, storagePath) {
  const root = storageRoot(storagePath)
  const key = installKey(variant, root)
  const existing = installs.get(key)
  if (existing) return existing.promise

  const disk = getDiskInfo(root, (variant.estimatedBytes || 0) + (variant.runtimeEstimatedBytes || 0))
  if (disk.available && disk.fits === false) {
    throw new Error('Not enough disk space for model')
  }

  const progress = {
    running: true,
    downloadedBytes: 0,
    totalBytes: variant.estimatedBytes || 0,
    percent: 0,
    file: ''
  }
  let previousBytes = 0

  const updateProgress = (downloadedBytes, totalBytes, file) => {
    progress.downloadedBytes = previousBytes + downloadedBytes
    progress.totalBytes = (variant.runtimeEstimatedBytes || 0) + (variant.estimatedBytes || 0) || totalBytes || progress.totalBytes
    progress.percent = progress.totalBytes ? Number(((progress.downloadedBytes / progress.totalBytes) * 100).toFixed(1)) : 0
    progress.file = file || progress.file
  }

  const promise = installRuntimeVariant(variant, updateProgress).then((runtimeResult) => {
    previousBytes = runtimeResult ? variant.runtimeEstimatedBytes || runtimeResult.bytes || previousBytes : 0
    return runInstallVariant(variant, root, updateProgress)
  }).finally(() => {
    installs.delete(key)
  })

  installs.set(key, { progress, promise })
  return promise
}

function replaceArgTokens (value, variant, storagePath) {
  return String(value)
    .replace(/\{port\}/g, String(RUNTIME_PORT))
    .replace(/\{modelPath\}/g, modelPathFor(variant, storagePath))
    .replace(/\{modelRef\}/g, variant.modelRef || '')
    .replace(/\{backendDir\}/g, __dirname)
}

function runtimeBaseUrl (variant, storagePath) {
  return replaceArgTokens(variant.baseUrl || `http://127.0.0.1:${RUNTIME_PORT}/v1`, variant, storagePath)
}

function startRuntime (variant, storagePath) {
  if (state.child) return
  clearIdleTimer()

  const runtime = runtimeStatus(variant)
  if (!runtime.available) throw new Error(runtime.message)

  const args = (variant.serverArgs || []).map((arg) => replaceArgTokens(arg, variant, storagePath))
  state.child = childProcess.spawn(runtime.command, args, {
    stdio: ['ignore', 'ignore', 'ignore'],
    detached: false
  })
  state.variant = variant
  state.storagePath = storageRoot(storagePath)
  state.lastError = ''
  state.child.on('error', (error) => {
    state.lastError = error.message
    clearIdleTimer()
    state.child = null
    state.variant = null
    state.storagePath = null
  })
  state.child.on('exit', () => {
    clearIdleTimer()
    state.child = null
    state.variant = null
    state.storagePath = null
  })
}

function clearIdleTimer () {
  if (!state.idleTimer) return
  clearTimeout(state.idleTimer)
  state.idleTimer = null
}

function scheduleIdleStop () {
  clearIdleTimer()
  state.lastUsedAt = new Date().toISOString()
  if (!state.child || IDLE_TIMEOUT_MS <= 0) return

  state.idleTimer = setTimeout(() => {
    stopRuntime()
  }, IDLE_TIMEOUT_MS)
}

function stopRuntime () {
  clearIdleTimer()
  if (!state.child) return
  state.child.kill()
  state.child = null
  state.variant = null
  state.storagePath = null
}

function deleteVariantModel (variant, storagePath) {
  stopRuntime()
  clearVariantTranslationCache(variant.id)
  const modelDir = modelDirFor(variant, storagePath)
  fs.rmSync(modelDir, { recursive: true, force: true })
  return { deletedPath: modelDir }
}

function normalizeContext (context) {
  if (!Array.isArray(context)) return []

  let used = 0
  const normalized = []
  context.slice(-MAX_CONTEXT_ITEMS).forEach((item) => {
    const text = typeof item === 'string' ? item : item && item.text
    if (!text) return
    const clipped = String(text).replace(/\s+/g, ' ').trim()
    if (!clipped) return
    const remaining = MAX_CONTEXT_CHARS - used
    if (remaining <= 0) return
    const next = clipped.slice(0, remaining)
    used += next.length
    normalized.push(next)
  })
  return normalized
}

function buildTranslationRequest (variant, body) {
  const source = body.source || 'auto'
  const target = body.target || 'vi'
  const context = normalizeContext(body.context)
  const isMlx = variant.runtime === 'mlx'
  const content = isMlx
    ? `<<<source>>>${source}<<<target>>>${target}<<<text>>>${body.text || ''}`
    : body.text || ''
  const request = {
    model: variant.modelRef || variant.model,
    messages: [{
      role: 'user',
      content
    }],
    temperature: 0,
    max_tokens: 512
  }
  if (!isMlx) {
    request.chat_template_kwargs = {
      source_lang_code: source,
      target_lang_code: target,
      context
    }
  }
  return request
}

function translationCacheKey (variant, body) {
  return JSON.stringify({
    variant: variant.id,
    source: body.source || 'auto',
    target: body.target || 'vi',
    text: body.text || '',
    context: normalizeContext(body.context)
  })
}

function getCachedTranslation (key) {
  if (!translationCache.has(key)) return null

  const value = translationCache.get(key)
  translationCache.delete(key)
  translationCache.set(key, value)
  return value
}

function setCachedTranslation (key, value) {
  translationCache.set(key, value)
  if (translationCache.size <= TRANSLATION_CACHE_LIMIT) return

  const oldestKey = translationCache.keys().next().value
  translationCache.delete(oldestKey)
}

function clearVariantTranslationCache (variantId) {
  for (const key of translationCache.keys()) {
    if (key.startsWith(`{"variant":"${variantId}"`)) {
      translationCache.delete(key)
    }
  }
}

function assertModelInstalled (variant, storagePath) {
  const status = variantStatus(variant, storagePath)
  if (!status.installed) {
    throw new Error(status.installing ? 'Model is still downloading' : 'Model is not installed')
  }
}

function postJson (url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const data = JSON.stringify(body)
    const client = parsed.protocol === 'https:' ? https : http
    const req = client.request({
      method: 'POST',
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let raw = ''
      res.on('data', (chunk) => { raw += chunk })
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Runtime returned HTTP ${res.statusCode}`))
          return
        }
        try {
          resolve(JSON.parse(raw))
        } catch (error) {
          reject(new Error('Runtime returned invalid JSON'))
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(60000, () => {
      req.destroy(new Error('Runtime request timed out'))
    })
    req.write(data)
    req.end()
  })
}

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function postJsonWithRetry (url, body) {
  let lastError
  for (let i = 0; i < 30; i++) {
    try {
      return await postJson(url, body)
    } catch (error) {
      lastError = error
      if (!['ECONNREFUSED', 'ECONNRESET'].includes(error.code)) break
      await sleep(1000)
    }
  }
  throw lastError
}

async function translate (body) {
  if (!body.text) throw new Error('Missing text')
  if (!body.target) throw new Error('Missing target')

  const manifest = loadManifest()
  const variant = state.variant || selectVariant(manifest, body.variantId)
  const cacheKey = translationCacheKey(variant, body)

  if (process.env.ZADARK_LOCAL_TRANSLATE_MOCK === '1') {
    const cached = getCachedTranslation(cacheKey)
    if (cached) return { ...cached, cached: true }

    const result = {
      success: true,
      languageName: body.source || 'Auto',
      translation: `[${body.target}] ${body.text}`,
      model: 'mock'
    }
    setCachedTranslation(cacheKey, result)
    return result
  }

  const root = storageRoot(body.storagePath)
  assertModelInstalled(variant, root)

  const cached = getCachedTranslation(cacheKey)
  if (cached) return { ...cached, cached: true }

  startRuntime(variant, root)

  const upstream = process.env.ZADARK_LOCAL_TRANSLATE_UPSTREAM || runtimeBaseUrl(variant, root)
  const runtimeResponse = await postJsonWithRetry(`${upstream}/chat/completions`, buildTranslationRequest(variant, body))

  const translation = runtimeResponse &&
    runtimeResponse.choices &&
    runtimeResponse.choices[0] &&
    runtimeResponse.choices[0].message &&
    runtimeResponse.choices[0].message.content

  if (!translation) throw new Error('Runtime response did not include translated text')

  scheduleIdleStop()

  const result = {
    success: true,
    languageName: body.source || 'Auto',
    translation: translation.trim(),
    model: variant.id
  }
  setCachedTranslation(cacheKey, result)
  return result
}

async function route (req, res) {
  if (!isAllowedOrigin(req.headers.origin)) {
    return json(req, res, 403, { success: false, message: 'Origin is not allowed' })
  }

  if (req.method === 'OPTIONS') return json(req, res, 204, {})

  try {
    const manifest = loadManifest()
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`)

    if (req.method === 'GET' && url.pathname === '/health') {
      return json(req, res, 200, { ok: true })
    }

    if (req.method === 'GET' && url.pathname === '/v1/local-translate/status') {
      const storagePath = url.searchParams.get('storagePath') || DEFAULT_STORAGE_DIR
      const variant = state.variant || selectVariant(manifest, url.searchParams.get('variantId'))
      return json(req, res, 200, {
        hardware: detectHardware(),
        selected: variantStatus(variant, storagePath),
        variants: manifest.variants.map((variant) => variantStatus(variant, storagePath))
      })
    }

    if (req.method === 'POST' && url.pathname === '/v1/local-translate/install') {
      const body = await readJsonBody(req)
      const variant = selectVariant(manifest, body.variantId)
      const result = await installVariant(variant, body.storagePath)
      return json(req, res, 200, { success: true, variant: variant.id, ...result })
    }

    if (req.method === 'POST' && url.pathname === '/v1/local-translate/start') {
      const body = await readJsonBody(req)
      const variant = selectVariant(manifest, body.variantId)
      const root = storageRoot(body.storagePath)
      assertModelInstalled(variant, root)
      startRuntime(variant, root)
      scheduleIdleStop()
      return json(req, res, 200, { success: true, variant: variant.id })
    }

    if (req.method === 'POST' && url.pathname === '/v1/local-translate/stop') {
      stopRuntime()
      return json(req, res, 200, { success: true })
    }

    if (req.method === 'POST' && url.pathname === '/v1/local-translate/delete-model') {
      const body = await readJsonBody(req)
      const variant = selectVariant(manifest, body.variantId)
      if (installProgressFor(variant, body.storagePath)) {
        return json(req, res, 409, { success: false, message: 'Model is still downloading' })
      }
      return json(req, res, 200, { success: true, variant: variant.id, ...deleteVariantModel(variant, body.storagePath) })
    }

    if (req.method === 'POST' && url.pathname === '/v1/translate') {
      const body = await readJsonBody(req)
      return json(req, res, 200, await translate(body))
    }

    return json(req, res, 404, { success: false, message: 'Not found' })
  } catch (error) {
    return json(req, res, 500, { success: false, message: error.message })
  }
}

function selfCheck () {
  const manifest = loadManifest()
  const llamaVariant = selectVariant(manifest, 'desktop-llamacpp-translategemma-4b-q4')
  assert(llamaVariant.id === 'desktop-llamacpp-translategemma-4b-q4')
  assert(fs.existsSync(replaceArgTokens(llamaVariant.serverArgs[llamaVariant.serverArgs.length - 1], llamaVariant, os.tmpdir())))
  assert(variantStatus(selectVariant(manifest, 'macos-arm64-mlx-translategemma-4b-q4'), os.tmpdir()).downloadable)
  assert(variantStatus(selectVariant(manifest, 'desktop-llamacpp-translategemma-4b-q4'), os.tmpdir()).downloadable)
  assert(!runtimeStatus({ serverCommand: '__zadark_missing_runtime__' }).available)
  assert(resolveRuntimeCommand({ runtimeCandidates: [process.execPath] }) === process.execPath)
  assert.throws(() => validateArchiveEntries(['../escape']), /Refusing unsafe runtime archive path/)
  assert(translationCacheKey({ id: 'v' }, { text: 'hello', target: 'vi', context: ['a'] }).includes('"context":["a"]'))
  assert(normalizeContext(Array.from({ length: 20 }, (_, i) => `msg ${i}`)).length === 10)
  assert(buildTranslationRequest({ runtime: 'llama.cpp', model: 'test' }, { text: 'hello', source: 'en', target: 'vi', context: ['previous'] }).chat_template_kwargs.context[0] === 'previous')
  assert(parseDfOutput('Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk 100 40 60 40% /tmp').freeBytes === 61440)
  assert(IDLE_TIMEOUT_MS >= 0)
  console.log('local-translate backend self-check passed')
}

if (require.main === module) {
  if (process.argv.includes('--self-check')) {
    selfCheck()
  } else {
    http.createServer(route).listen(PORT, '127.0.0.1', () => {
      console.log(`ZaDark local translation backend listening on http://127.0.0.1:${PORT}`)
    })
    process.on('exit', stopRuntime)
    process.on('SIGINT', () => {
      stopRuntime()
      process.exit(130)
    })
    process.on('SIGTERM', () => {
      stopRuntime()
      process.exit(143)
    })
  }
}

module.exports = {
  buildTranslationRequest,
  detectHardware,
  getDiskInfo,
  installVariant,
  normalizeContext,
  parseDfOutput,
  resolveRuntimeCommand,
  route,
  runtimeStatus,
  selectVariant,
  startRuntime,
  stopRuntime,
  validateArchiveEntries,
  variantStatus
}
