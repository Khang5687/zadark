const fs = require('fs')
const crypto = require('crypto')
const http = require('http')
const os = require('os')
const path = require('path')

const backend = require('../src/pc/local-translate/backend')

function requestJson (baseUrl, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(baseUrl + pathname, { headers }, (res) => {
      let raw = ''
      res.on('data', (chunk) => { raw += chunk })
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(raw) })
        } catch (error) {
          reject(error)
        }
      })
    }).on('error', reject)
  })
}

function postJson (baseUrl, pathname, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const req = http.request(baseUrl + pathname, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let raw = ''
      res.on('data', (chunk) => { raw += chunk })
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) })
        } catch (error) {
          reject(error)
        }
      })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('local translate backend', () => {
  let server
  let baseUrl
  let tempDir
  let hfServer
  let hfBaseUrl
  let releaseSlowDownload

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zadark-local-translate-'))
    server = http.createServer(backend.route)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    baseUrl = `http://127.0.0.1:${address.port}`

    hfServer = http.createServer((req, res) => {
      if (req.url.startsWith('/api/models/test/model/tree/main')) {
        const model = 'tiny model'
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify([
          {
            type: 'file',
            path: 'config.json',
            size: Buffer.byteLength('{"ok":true}'),
            lfs: { oid: crypto.createHash('sha256').update('{"ok":true}').digest('hex') }
          },
          {
            type: 'file',
            path: 'model.safetensors',
            size: Buffer.byteLength(model),
            lfs: { oid: crypto.createHash('sha256').update(model).digest('hex') }
          }
        ]))
        return
      }

      if (req.url.startsWith('/api/models/slow/model/tree/main') ||
        req.url.startsWith('/api/models/mlx-community/translategemma-4b-it-4bit_immersive-translate/tree/main')) {
        const model = 'slow model'
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify([
          {
            type: 'file',
            path: 'model.safetensors',
            size: Buffer.byteLength(model),
            lfs: { oid: crypto.createHash('sha256').update(model).digest('hex') }
          }
        ]))
        return
      }

      if (req.url === '/test/model/resolve/main/config.json') {
        res.writeHead(307, { Location: '/resolve-cache/config.json' })
        res.end()
        return
      }

      if (req.url === '/resolve-cache/config.json') {
        res.writeHead(200)
        res.end('{"ok":true}')
        return
      }

      if (req.url === '/test/model/resolve/main/model.safetensors') {
        res.writeHead(200)
        res.end('tiny model')
        return
      }

      if (req.url === '/slow/model/resolve/main/model.safetensors' ||
        req.url === '/mlx-community/translategemma-4b-it-4bit_immersive-translate/resolve/main/model.safetensors') {
        res.writeHead(200)
        res.write('slow ')
        releaseSlowDownload = () => res.end('model')
        return
      }

      res.writeHead(404)
      res.end('not found')
    })
    await new Promise((resolve) => hfServer.listen(0, '127.0.0.1', resolve))
    const hfAddress = hfServer.address()
    hfBaseUrl = `http://127.0.0.1:${hfAddress.port}`
  })

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
    await new Promise((resolve) => hfServer.close(resolve))
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('parses df output for disk visualization', () => {
    const disk = backend.parseDfOutput('Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk 100 40 60 40% /tmp')
    expect(disk.totalBytes).toBe(102400)
    expect(disk.freeBytes).toBe(61440)
  })

  it('caps context separately from TranslateGemma marker text', () => {
    const messages = backend.buildTranslationMessages({
      text: 'hello',
      source: 'en',
      target: 'vi',
      context: Array.from({ length: 20 }, (_, i) => `message ${i}`)
    })

    expect(messages).toHaveLength(11)
    expect(messages[0].content).not.toContain('message 0')
    expect(messages[0].content).toContain('message 10')
    expect(messages[9].content).toContain('message 19')
    expect(messages[10].content).toBe('<<<source>>>en<<<target>>>vi<<<text>>>hello')
  })

  it('reports selected model, disk info, and storage path', async () => {
    const result = await requestJson(baseUrl, `/v1/local-translate/status?storagePath=${encodeURIComponent(tempDir)}`)

    expect(result.status).toBe(200)
    expect(result.body.selected.storagePath).toBe(tempDir)
    expect(result.body.selected.disk).toHaveProperty('available')
    expect(result.body.selected.estimatedBytes).toBeGreaterThan(0)
    expect(result.body.selected).toHaveProperty('runtimeAvailable')
  })

  it('rejects browser requests from unknown origins', async () => {
    const result = await requestJson(baseUrl, '/v1/local-translate/status', {
      Origin: 'https://example.com'
    })

    expect(result.status).toBe(403)
    expect(result.headers['access-control-allow-origin']).toBeUndefined()
    expect(result.body.message).toBe('Origin is not allowed')
  })

  it('allows local translate requests from Zalo origins', async () => {
    const result = await requestJson(baseUrl, '/v1/local-translate/status', {
      Origin: 'https://chat.zalo.me'
    })

    expect(result.status).toBe(200)
    expect(result.body.selected).toHaveProperty('runtimeAvailable')
  })

  it('reports missing runtime commands before startup', () => {
    const runtime = backend.runtimeStatus({ serverCommand: '__zadark_missing_runtime__' })

    expect(runtime.available).toBe(false)
    expect(runtime.message).toContain('Runtime command not found')
  })

  it('resolves bundled runtime candidates before path fallbacks', () => {
    const runtime = backend.resolveRuntimeCommand({
      runtimeCandidates: ['__zadark_missing_runtime__', process.execPath]
    })

    expect(runtime).toBe(process.execPath)
  })

  it('caches runtime readiness checks briefly', () => {
    const runtimePath = path.join(tempDir, 'fake-mlx-runtime')
    const callsPath = path.join(tempDir, 'fake-mlx-runtime-calls')
    fs.writeFileSync(runtimePath, `#!/bin/sh\necho call >> ${JSON.stringify(callsPath)}\n`)
    fs.chmodSync(runtimePath, 0o755)

    const variant = {
      id: 'cached-runtime-test',
      runtime: 'mlx',
      serverCommand: runtimePath
    }

    expect(backend.runtimeStatus(variant).available).toBe(true)
    expect(backend.runtimeStatus(variant).available).toBe(true)
    expect(fs.readFileSync(callsPath, 'utf8').trim().split(/\r?\n/)).toHaveLength(1)
  })

  it('reports running only for the active variant', () => {
    const active = {
      id: 'active-runtime-test',
      runtime: 'test',
      runtimeCandidates: [process.execPath],
      serverArgs: ['-e', 'setTimeout(function () {}, 30000)']
    }
    const inactive = {
      id: 'inactive-runtime-test',
      runtime: 'test',
      runtimeCandidates: [process.execPath]
    }

    try {
      backend.startRuntime(active, tempDir)
      expect(backend.variantStatus(active, tempDir).running).toBe(true)
      expect(backend.variantStatus(inactive, tempDir).running).toBe(false)
    } finally {
      backend.stopRuntime()
    }
  })

  it('caches repeated local translation responses by text, target, and context', async () => {
    const previousMock = process.env.ZADARK_LOCAL_TRANSLATE_MOCK
    process.env.ZADARK_LOCAL_TRANSLATE_MOCK = '1'

    try {
      const body = {
        variantId: 'desktop-llamacpp-translategemma-4b-q4',
        text: 'cache me',
        target: 'vi',
        context: ['previous']
      }

      const first = await postJson(baseUrl, '/v1/translate', body)
      const second = await postJson(baseUrl, '/v1/translate', body)
      const differentContext = await postJson(baseUrl, '/v1/translate', { ...body, context: ['other'] })
      await postJson(baseUrl, '/v1/local-translate/delete-model', {
        variantId: body.variantId,
        storagePath: tempDir
      })
      const afterDelete = await postJson(baseUrl, '/v1/translate', body)

      expect(first.status).toBe(200)
      expect(first.body.cached).toBeUndefined()
      expect(second.body.cached).toBe(true)
      expect(differentContext.body.cached).toBeUndefined()
      expect(afterDelete.body.cached).toBeUndefined()
    } finally {
      if (previousMock) {
        process.env.ZADARK_LOCAL_TRANSLATE_MOCK = previousMock
      } else {
        delete process.env.ZADARK_LOCAL_TRANSLATE_MOCK
      }
    }
  })

  it('rejects real translation when the selected model is not installed', async () => {
    const previousMock = process.env.ZADARK_LOCAL_TRANSLATE_MOCK
    const body = {
      variantId: 'desktop-llamacpp-translategemma-4b-q4',
      storagePath: tempDir,
      text: 'hello',
      target: 'vi'
    }

    try {
      process.env.ZADARK_LOCAL_TRANSLATE_MOCK = '1'
      await postJson(baseUrl, '/v1/translate', body)

      delete process.env.ZADARK_LOCAL_TRANSLATE_MOCK
      const result = await postJson(baseUrl, '/v1/translate', body)

      expect(result.status).toBe(500)
      expect(result.body.message).toBe('Model is not installed')
    } finally {
      if (previousMock) {
        process.env.ZADARK_LOCAL_TRANSLATE_MOCK = previousMock
      }
    }
  })

  it('does not start a runtime before the model is installed', async () => {
    const result = await postJson(baseUrl, '/v1/local-translate/start', {
      variantId: 'macos-arm64-mlx-translategemma-4b-q4',
      storagePath: path.join(tempDir, 'missing-start-model')
    })

    expect(result.status).toBe(500)
    expect(result.body.message).toBe('Model is not installed')
  })

  it('downloads Hugging Face snapshot variants without external tools', async () => {
    const previousEndpoint = process.env.ZADARK_HF_ENDPOINT
    process.env.ZADARK_HF_ENDPOINT = hfBaseUrl

    try {
      const variant = {
        id: 'test-hf-snapshot',
        runtime: 'mlx',
        modelRef: 'test/model',
        downloadKind: 'hf-snapshot',
        revision: 'main'
      }

      const before = backend.variantStatus(variant, tempDir)
      expect(before.downloadable).toBe(true)
      expect(before.installed).toBe(false)

      const installed = await backend.installVariant(variant, tempDir)
      expect(installed.files).toBe(2)
      expect(fs.readFileSync(path.join(installed.path, 'config.json'), 'utf8')).toBe('{"ok":true}')
      expect(fs.readFileSync(path.join(installed.path, 'model.safetensors'), 'utf8')).toBe('tiny model')

      const after = backend.variantStatus(variant, tempDir)
      expect(after.installed).toBe(true)

      const second = await backend.installVariant(variant, tempDir)
      expect(second.alreadyInstalled).toBe(true)

      fs.rmSync(path.join(installed.path, 'model.safetensors'))
      const afterManualDelete = backend.variantStatus(variant, tempDir)
      expect(afterManualDelete.installed).toBe(false)
    } finally {
      if (previousEndpoint) {
        process.env.ZADARK_HF_ENDPOINT = previousEndpoint
      } else {
        delete process.env.ZADARK_HF_ENDPOINT
      }
    }
  })

  it('rejects model install when disk space is too low', async () => {
    const variant = {
      id: 'too-large-hf-snapshot',
      runtime: 'mlx',
      modelRef: 'test/model',
      downloadKind: 'hf-snapshot',
      revision: 'main',
      estimatedBytes: Number.MAX_SAFE_INTEGER
    }

    await expect(backend.installVariant(variant, tempDir)).rejects.toThrow('Not enough disk space for model')
  })

  it('reports install progress while a snapshot download is running', async () => {
    const previousEndpoint = process.env.ZADARK_HF_ENDPOINT
    process.env.ZADARK_HF_ENDPOINT = hfBaseUrl
    releaseSlowDownload = null

    try {
      const variant = {
        id: 'slow-hf-snapshot',
        runtime: 'mlx',
        modelRef: 'slow/model',
        downloadKind: 'hf-snapshot',
        revision: 'main',
        estimatedBytes: 10
      }

      const installPromise = backend.installVariant(variant, tempDir)
      for (let i = 0; i < 20 && !releaseSlowDownload; i++) await sleep(10)

      const during = backend.variantStatus(variant, tempDir)
      expect(during.installing).toBe(true)
      expect(during.installProgress.downloadedBytes).toBe(5)
      expect(during.installProgress.totalBytes).toBe(10)

      const release = releaseSlowDownload
      releaseSlowDownload = null
      expect(typeof release).toBe('function')
      release()
      await installPromise

      const after = backend.variantStatus(variant, tempDir)
      expect(after.installing).toBe(false)
      expect(after.installed).toBe(true)
    } finally {
      if (releaseSlowDownload) releaseSlowDownload()
      if (previousEndpoint) {
        process.env.ZADARK_HF_ENDPOINT = previousEndpoint
      } else {
        delete process.env.ZADARK_HF_ENDPOINT
      }
    }
  })

  it('does not delete a model while a snapshot download is running', async () => {
    const previousEndpoint = process.env.ZADARK_HF_ENDPOINT
    process.env.ZADARK_HF_ENDPOINT = hfBaseUrl
    releaseSlowDownload = null

    try {
      const body = {
        variantId: 'macos-arm64-mlx-translategemma-4b-q4',
        storagePath: path.join(tempDir, 'delete-during-install')
      }

      const installPromise = postJson(baseUrl, '/v1/local-translate/install', body)
      for (let i = 0; i < 20 && !releaseSlowDownload; i++) await sleep(10)

      const deleted = await postJson(baseUrl, '/v1/local-translate/delete-model', body)
      expect(deleted.status).toBe(409)
      expect(deleted.body.message).toBe('Model is still downloading')

      const release = releaseSlowDownload
      releaseSlowDownload = null
      expect(typeof release).toBe('function')
      release()
      const installed = await installPromise
      expect(installed.status).toBe(200)
    } finally {
      if (releaseSlowDownload) releaseSlowDownload()
      if (previousEndpoint) {
        process.env.ZADARK_HF_ENDPOINT = previousEndpoint
      } else {
        delete process.env.ZADARK_HF_ENDPOINT
      }
    }
  })
})
