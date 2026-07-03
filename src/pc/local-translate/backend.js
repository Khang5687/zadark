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
const MANIFEST_PATH = process.env.ZADARK_LOCAL_TRANSLATE_MANIFEST || path.join(__dirname, 'model-manifest.json')
const DEFAULT_STORAGE_DIR = process.env.ZADARK_LOCAL_TRANSLATE_STORAGE_DIR || DATA_DIR
const IDLE_TIMEOUT_MS = Number(process.env.ZADARK_LOCAL_TRANSLATE_IDLE_MS || 15 * 60 * 1000)

const state = {
  child: null,
  variant: null,
  lastError: '',
  lastUsedAt: null,
  idleTimer: null
}

function json (res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  })
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
  return manifest.variants
    .slice()
    .sort((a, b) => scoreVariant(b, hardware) - scoreVariant(a, hardware))[0]
}

function storageRoot (storagePath) {
  return path.resolve(storagePath || DEFAULT_STORAGE_DIR)
}

function modelDirFor (variant, storagePath) {
  return path.join(storageRoot(storagePath), 'models', variant.id)
}

function modelPathFor (variant, storagePath) {
  return path.join(modelDirFor(variant, storagePath), path.basename(variant.modelRef || 'model.bin'))
}

function directorySize (targetPath) {
  if (!fs.existsSync(targetPath)) return 0
  const stat = fs.statSync(targetPath)
  if (!stat.isDirectory()) return stat.size

  return fs.readdirSync(targetPath).reduce((total, name) => {
    return total + directorySize(path.join(targetPath, name))
  }, 0)
}

function variantStatus (variant, storagePath) {
  const root = storageRoot(storagePath)
  const modelPath = modelPathFor(variant, root)
  const modelDir = modelDirFor(variant, root)
  const estimatedBytes = variant.estimatedBytes || 0
  return {
    id: variant.id,
    runtime: variant.runtime,
    model: variant.model,
    modelRef: variant.modelRef,
    estimatedBytes,
    storagePath: root,
    modelPath,
    installed: variant.modelUrl ? fs.existsSync(modelPath) : false,
    downloadable: !!variant.modelUrl,
    disk: getDiskInfo(root, estimatedBytes),
    usedBytes: directorySize(modelDir),
    running: !!state.child,
    idleTimeoutMs: IDLE_TIMEOUT_MS,
    lastUsedAt: state.lastUsedAt,
    lastError: state.lastError
  }
}

function downloadFile (url, destPath, expectedSha256) {
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
        downloadFile(response.headers.location, destPath, expectedSha256).then(resolve, reject)
        return
      }

      if (response.statusCode !== 200) {
        file.close()
        fs.rmSync(tmpPath, { force: true })
        reject(new Error(`Download failed with HTTP ${response.statusCode}`))
        return
      }

      response.on('data', (chunk) => hash.update(chunk))
      response.pipe(file)
      file.on('finish', () => {
        file.close(() => {
          const actualSha256 = hash.digest('hex')
          if (expectedSha256 && actualSha256 !== expectedSha256) {
            fs.rmSync(tmpPath, { force: true })
            reject(new Error('Downloaded model checksum mismatch'))
            return
          }
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

async function installVariant (variant, storagePath) {
  if (!variant.modelUrl) {
    throw new Error(`Variant ${variant.id} has no modelUrl yet. Add an approved model artifact URL to the manifest.`)
  }

  const modelPath = modelPathFor(variant, storagePath)
  if (fs.existsSync(modelPath)) return { path: modelPath, alreadyInstalled: true }
  return downloadFile(variant.modelUrl, modelPath, variant.sha256)
}

function replaceArgTokens (value, variant, storagePath) {
  return String(value)
    .replace(/\{port\}/g, String(RUNTIME_PORT))
    .replace(/\{modelPath\}/g, modelPathFor(variant, storagePath))
    .replace(/\{modelRef\}/g, variant.modelRef || '')
}

function runtimeBaseUrl (variant, storagePath) {
  return replaceArgTokens(variant.baseUrl || `http://127.0.0.1:${RUNTIME_PORT}/v1`, variant, storagePath)
}

function startRuntime (variant, storagePath) {
  if (state.child) return
  clearIdleTimer()

  if (!variant.serverCommand) {
    throw new Error(`Variant ${variant.id} does not define a runtime command`)
  }

  if (!commandExists(variant.serverCommand)) {
    throw new Error(`Runtime command not found: ${variant.serverCommand}`)
  }

  const args = (variant.serverArgs || []).map((arg) => replaceArgTokens(arg, variant, storagePath))
  state.child = childProcess.spawn(variant.serverCommand, args, {
    stdio: ['ignore', 'ignore', 'ignore'],
    detached: false
  })
  state.variant = variant
  state.lastError = ''
  state.child.on('error', (error) => {
    state.lastError = error.message
    clearIdleTimer()
    state.child = null
    state.variant = null
  })
  state.child.on('exit', () => {
    clearIdleTimer()
    state.child = null
    state.variant = null
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
}

function deleteVariantModel (variant, storagePath) {
  stopRuntime()
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

function buildTranslationMessages (body) {
  const source = body.source || 'auto'
  const target = body.target || 'vi'
  const context = normalizeContext(body.context)
  const contextText = context.length
    ? `Context:\n${context.map((line) => `- ${line}`).join('\n')}\n\n`
    : ''

  return [
    {
      role: 'user',
      content: `<<<source>>>${source}<<<target>>>${target}<<<text>>>${contextText}${body.text || ''}`
    }
  ]
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

  if (process.env.ZADARK_LOCAL_TRANSLATE_MOCK === '1') {
    return {
      success: true,
      languageName: body.source || 'Auto',
      translation: `[${body.target}] ${body.text}`,
      model: 'mock'
    }
  }

  const manifest = loadManifest()
  const variant = state.variant || selectVariant(manifest, body.variantId)
  const root = storageRoot(body.storagePath)
  startRuntime(variant, root)

  const upstream = process.env.ZADARK_LOCAL_TRANSLATE_UPSTREAM || runtimeBaseUrl(variant, root)
  const runtimeResponse = await postJsonWithRetry(`${upstream}/chat/completions`, {
    model: variant.modelRef || variant.model,
    messages: buildTranslationMessages(body),
    temperature: 0,
    max_tokens: 512
  })

  const translation = runtimeResponse &&
    runtimeResponse.choices &&
    runtimeResponse.choices[0] &&
    runtimeResponse.choices[0].message &&
    runtimeResponse.choices[0].message.content

  if (!translation) throw new Error('Runtime response did not include translated text')

  scheduleIdleStop()

  return {
    success: true,
    languageName: body.source || 'Auto',
    translation: translation.trim(),
    model: variant.id
  }
}

async function route (req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {})

  try {
    const manifest = loadManifest()
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`)

    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, { ok: true })
    }

    if (req.method === 'GET' && url.pathname === '/v1/local-translate/status') {
      const storagePath = url.searchParams.get('storagePath') || DEFAULT_STORAGE_DIR
      const variant = state.variant || selectVariant(manifest, url.searchParams.get('variantId'))
      return json(res, 200, {
        hardware: detectHardware(),
        selected: variantStatus(variant, storagePath),
        variants: manifest.variants.map((variant) => variantStatus(variant, storagePath))
      })
    }

    if (req.method === 'POST' && url.pathname === '/v1/local-translate/install') {
      const body = await readJsonBody(req)
      const variant = selectVariant(manifest, body.variantId)
      const result = await installVariant(variant, body.storagePath)
      return json(res, 200, { success: true, variant: variant.id, ...result })
    }

    if (req.method === 'POST' && url.pathname === '/v1/local-translate/start') {
      const body = await readJsonBody(req)
      const variant = selectVariant(manifest, body.variantId)
      startRuntime(variant, body.storagePath)
      return json(res, 200, { success: true, variant: variant.id })
    }

    if (req.method === 'POST' && url.pathname === '/v1/local-translate/stop') {
      stopRuntime()
      return json(res, 200, { success: true })
    }

    if (req.method === 'POST' && url.pathname === '/v1/local-translate/delete-model') {
      const body = await readJsonBody(req)
      const variant = selectVariant(manifest, body.variantId)
      return json(res, 200, { success: true, variant: variant.id, ...deleteVariantModel(variant, body.storagePath) })
    }

    if (req.method === 'POST' && url.pathname === '/v1/translate') {
      const body = await readJsonBody(req)
      return json(res, 200, await translate(body))
    }

    return json(res, 404, { success: false, message: 'Not found' })
  } catch (error) {
    return json(res, 500, { success: false, message: error.message })
  }
}

function selfCheck () {
  const manifest = loadManifest()
  assert(selectVariant(manifest, 'desktop-llamacpp-translategemma-4b-q4').id === 'desktop-llamacpp-translategemma-4b-q4')
  assert(normalizeContext(Array.from({ length: 20 }, (_, i) => `msg ${i}`)).length === 10)
  assert(buildTranslationMessages({ text: 'hello', source: 'en', target: 'vi', context: ['previous'] })[0].content.includes('previous'))
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
  buildTranslationMessages,
  detectHardware,
  getDiskInfo,
  normalizeContext,
  parseDfOutput,
  route,
  selectVariant,
  variantStatus
}
