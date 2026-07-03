const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')

const backend = require('../src/pc/local-translate/backend')

function requestJson (baseUrl, pathname) {
  return new Promise((resolve, reject) => {
    http.get(baseUrl + pathname, (res) => {
      let raw = ''
      res.on('data', (chunk) => { raw += chunk })
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) })
        } catch (error) {
          reject(error)
        }
      })
    }).on('error', reject)
  })
}

describe('local translate backend', () => {
  let server
  let baseUrl
  let tempDir

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zadark-local-translate-'))
    server = http.createServer(backend.route)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('parses df output for disk visualization', () => {
    const disk = backend.parseDfOutput('Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk 100 40 60 40% /tmp')
    expect(disk.totalBytes).toBe(102400)
    expect(disk.freeBytes).toBe(61440)
  })

  it('caps context and uses TranslateGemma prompt markers', () => {
    const messages = backend.buildTranslationMessages({
      text: 'hello',
      source: 'en',
      target: 'vi',
      context: Array.from({ length: 20 }, (_, i) => `message ${i}`)
    })

    expect(messages).toHaveLength(1)
    expect(messages[0].content).toContain('<<<source>>>en<<<target>>>vi<<<text>>>')
    expect(messages[0].content).not.toContain('message 0')
    expect(messages[0].content).toContain('message 19')
  })

  it('reports selected model, disk info, and storage path', async () => {
    const result = await requestJson(baseUrl, `/v1/local-translate/status?storagePath=${encodeURIComponent(tempDir)}`)

    expect(result.status).toBe(200)
    expect(result.body.selected.storagePath).toBe(tempDir)
    expect(result.body.selected.disk).toHaveProperty('available')
    expect(result.body.selected.estimatedBytes).toBeGreaterThan(0)
  })
})
