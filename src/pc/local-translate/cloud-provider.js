const fs = require('fs')
const os = require('os')
const path = require('path')

const DATA_DIR = process.env.ZADARK_LOCAL_TRANSLATE_DIR || path.join(os.homedir(), '.zadark', 'local-translate')
const CONFIG_PATH = process.env.ZADARK_CLOUD_TRANSLATE_CONFIG || path.join(DATA_DIR, 'cloud-provider.json')

const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1-mini'
  },
  groq: {
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'openai/gpt-oss-20b'
  },
  xai: {
    name: 'xAI',
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-3-mini'
  },
  mistral: {
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest'
  },
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4.1-mini'
  },
  custom: {
    name: 'Tuỳ chỉnh',
    baseUrl: '',
    defaultModel: ''
  }
}

function secureStorage () {
  try {
    const storage = require('electron').safeStorage
    if (!storage || !storage.isEncryptionAvailable()) return null
    if (storage.getSelectedStorageBackend && storage.getSelectedStorageBackend() === 'basic_text') return null
    return storage
  } catch (error) {
    return null
  }
}

function encryptKey (value) {
  if (process.env.ZADARK_CLOUD_TRANSLATE_TEST_PLAINTEXT === '1') {
    return `test:${Buffer.from(value).toString('base64')}`
  }
  const storage = secureStorage()
  if (!storage) throw new Error('Secure API key storage is not available on this system')
  return storage.encryptString(value).toString('base64')
}

function decryptKey (value) {
  if (!value) return ''
  if (value.startsWith('test:') && process.env.ZADARK_CLOUD_TRANSLATE_TEST_PLAINTEXT === '1') {
    return Buffer.from(value.slice(5), 'base64').toString()
  }
  const storage = secureStorage()
  if (!storage) throw new Error('Secure API key storage is not available on this system')
  return storage.decryptString(Buffer.from(value, 'base64'))
}

function readStoredConfig (configPath = CONFIG_PATH) {
  if (!fs.existsSync(configPath)) return {}
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch (error) {
    throw new Error('Cloud translation configuration is invalid')
  }
}

function publicConfig (stored = readStoredConfig()) {
  const provider = PROVIDERS[stored.provider] ? stored.provider : 'openai'
  const preset = PROVIDERS[provider]
  return {
    provider,
    providerName: preset.name,
    model: stored.model || preset.defaultModel,
    baseUrl: provider === 'custom' ? stored.baseUrl || '' : preset.baseUrl,
    hasApiKey: !!stored.encryptedApiKey,
    providers: Object.entries(PROVIDERS).map(([id, value]) => ({ id, ...value }))
  }
}

function validateBaseUrl (provider, value) {
  const baseUrl = provider === 'custom' ? String(value || '').trim() : PROVIDERS[provider].baseUrl
  if (!baseUrl || baseUrl.length > 1000) throw new Error('Invalid cloud API base URL')
  let parsed
  try {
    parsed = new URL(baseUrl)
  } catch (error) {
    throw new Error('Invalid cloud API base URL')
  }
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    throw new Error('Custom cloud endpoints must use HTTPS or a loopback HTTP address')
  }
  if (parsed.username || parsed.password || parsed.hash) throw new Error('Invalid cloud API base URL')
  return baseUrl.replace(/\/+$/, '')
}

function validationError (message) {
  const error = new Error(message)
  error.statusCode = 400
  return error
}

function saveConfig (input, configPath = CONFIG_PATH) {
  const provider = String(input.provider || '')
  if (!PROVIDERS[provider]) throw validationError('Unknown cloud translation provider')
  const model = String(input.model || PROVIDERS[provider].defaultModel || '').trim()
  if (!model || model.length > 200 || /[\r\n]/.test(model)) throw validationError('Invalid cloud model name')
  let baseUrl
  try {
    baseUrl = validateBaseUrl(provider, input.baseUrl)
  } catch (error) {
    throw validationError(error.message)
  }
  const existing = readStoredConfig(configPath)
  let encryptedApiKey = existing.provider === provider ? existing.encryptedApiKey || '' : ''

  if (Object.prototype.hasOwnProperty.call(input, 'apiKey')) {
    const apiKey = String(input.apiKey || '').trim()
    if (apiKey.length > 4096 || /[\r\n]/.test(apiKey)) throw validationError('Invalid API key')
    encryptedApiKey = apiKey ? encryptKey(apiKey) : ''
  }
  if (provider !== 'custom' && !encryptedApiKey) throw validationError('API key is required')

  const stored = { provider, model, baseUrl, encryptedApiKey }
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(stored, null, 2), { mode: 0o600 })
  if (os.platform() !== 'win32') fs.chmodSync(configPath, 0o600)
  return publicConfig(stored)
}

function configuredProvider (configPath = CONFIG_PATH) {
  const stored = readStoredConfig(configPath)
  if (!stored.provider || !PROVIDERS[stored.provider]) {
    const error = new Error('Cloud translation is not configured')
    error.statusCode = 409
    throw error
  }
  const config = publicConfig(stored)
  return {
    ...config,
    apiKey: decryptKey(stored.encryptedApiKey || '')
  }
}

function deleteConfig (configPath = CONFIG_PATH) {
  fs.rmSync(configPath, { force: true })
  return publicConfig({})
}

function completionUrl (config) {
  return config.baseUrl.endsWith('/chat/completions')
    ? config.baseUrl
    : `${config.baseUrl}/chat/completions`
}

function requestHeaders (config) {
  return {
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    ...(config.provider === 'openrouter'
      ? { 'HTTP-Referer': 'https://zadark.com', 'X-Title': 'ZaDark' }
      : {})
  }
}

module.exports = {
  CONFIG_PATH,
  PROVIDERS,
  completionUrl,
  configuredProvider,
  deleteConfig,
  publicConfig,
  requestHeaders,
  saveConfig,
  validateBaseUrl
}
