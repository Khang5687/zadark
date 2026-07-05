(function ($) {
  const ZADARK_LOCAL_TRANSLATE_STORAGE_PATH_KEY = '@ZaDark:LOCAL_TRANSLATE_STORAGE_PATH'

  const getTranslateApiURL = () => {
    if (document.body.classList.contains('zadark-pc')) {
      return window.ZADARK_LOCAL_TRANSLATE_API_URL || 'http://127.0.0.1:5555/v1'
    }

    return ZADARK_API_URL
  }

  const isLocalTranslate = () => document.body.classList.contains('zadark-pc')

  const getLocalTranslateStoragePath = () => {
    return localStorage.getItem(ZADARK_LOCAL_TRANSLATE_STORAGE_PATH_KEY) || ''
  }

  const localTranslateStoragePayload = () => {
    if (!isLocalTranslate()) return {}

    const storagePath = getLocalTranslateStoragePath()
    return storagePath ? { storagePath } : {}
  }

  const formatBytes = (bytes) => {
    if (!bytes) return '0 MB'
    if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    }
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
  }

  let localTranslateNotReadyMessage = 'Bạn chưa tải model AI'

  const localTranslateNotReadyResult = (readiness, message) => ({
    success: false,
    pending: readiness === 'installing',
    message
  })

  const normalizeTranslateText = (text) => String(text || '').replace(/\r\n?/g, '\n').trim()

  const normalizeContextText = (text) => String(text || '').replace(/\s+/g, ' ').trim()

  const CONTEXT_MESSAGE_SELECTOR = '.card,.chatImageMessage,.chatImageMessage--audit'
  const CONTEXT_VISIBLE_LIMIT = 12
  const CONTEXT_MEMORY_MESSAGE_LIMIT = 50
  const CONTEXT_MEMORY_CHAT_LIMIT = 100
  const CONTEXT_MEMORY_CHAR_LIMIT = 8000
  const contextMemory = new Map()
  const activeTranslations = new Map()

  const getCurrentConvId = () => {
    return document.body.getAttribute('data-current-conv-id') || 'unknown'
  }

  const nodeText = (node) => normalizeContextText(node && node.textContent)

  const firstText = (root, selectors) => {
    if (!root) return ''
    for (const selector of selectors) {
      const node = root.querySelector(selector)
      const text = nodeText(node)
      if (text) return text
    }
    return ''
  }

  const classText = (node) => {
    return String(node && node.className && typeof node.className === 'string' ? node.className : '').toLowerCase()
  }

  const messageFrame = (messageEl) => {
    return (messageEl && messageEl.closest && messageEl.closest('.chat-message,[data-component="bubble-message"]')) || messageEl
  }

  const messageAttr = (messageEl, name) => {
    const frame = messageFrame(messageEl)
    return (messageEl && messageEl.getAttribute(name)) || (frame && frame !== messageEl && frame.getAttribute(name))
  }

  const reactProps = (node) => {
    if (!node) return {}
    const key = Object.keys(node).find((key) => key.startsWith('__reactInternalInstance') || key.startsWith('__reactFiber'))
    const fiber = key && node[key]
    return (fiber && (fiber.memoizedProps || fiber.pendingProps)) || {}
  }

  const messageProps = (messageEl) => {
    let current = messageEl
    for (let i = 0; current && i < 5; i++) {
      const props = reactProps(current)
      if (props.data || props.message || props.senderName || props.sentByMe !== undefined || props.fromMe !== undefined) return props
      current = current.parentElement
    }
    return {}
  }

  const inferDirection = (messageEl) => {
    const props = messageProps(messageEl)
    const data = props.data || props.message || {}
    if (props.sentByMe === true || props.fromMe === true || props.isMe === true || props.isSelf === true) return 'outgoing'
    if (data.fromMe === true || data.isMe === true || data.isSelf === true || String(data.fromUid || '') === '0') return 'outgoing'

    if (messageAttr(messageEl, 'data-from-me') === 'true' || messageAttr(messageEl, 'data-is-me') === 'true') return 'outgoing'
    if (messageAttr(messageEl, 'data-from-me') === 'false' || messageAttr(messageEl, 'data-is-me') === 'false') return 'incoming'

    const frame = messageFrame(messageEl)
    const classes = `${classText(messageEl)} ${frame !== messageEl ? classText(frame) : ''}`.split(/\s+/)
    if (classes.some((name) => /(^|[-_])(me|mine|self|sent|send|outgoing|right)($|[-_])/.test(name))) return 'outgoing'
    if (classes.some((name) => /(^|[-_])(other|incoming|left)($|[-_])/.test(name))) return 'incoming'
    return 'unknown'
  }

  const inferSpeaker = (messageEl, direction) => {
    if (direction === 'outgoing') return 'Me'

    const props = messageProps(messageEl)
    const data = props.data || props.message || {}
    const explicit = messageEl && (
      messageAttr(messageEl, 'data-sender-name') ||
      messageAttr(messageEl, 'data-author') ||
      messageAttr(messageEl, 'aria-label') ||
      props.senderName ||
      props.displayName ||
      data.senderName ||
      data.displayName ||
      data.fromD ||
      data.fromDName
    )
    if (explicit) return normalizeContextText(explicit).slice(0, 40)

    const speaker = firstText(messageEl, [
      '[class*="sender"]',
      '[class*="author"]',
      '[class*="from"]',
      '[class*="name"]'
    ]) || firstText(messageFrame(messageEl), [
      '[class*="sender"]',
      '[class*="author"]',
      '[class*="from"]',
      '[class*="name"]'
    ])
    return speaker ? speaker.slice(0, 40) : (direction === 'incoming' ? 'Them' : 'Unknown')
  }

  const mediaPlaceholder = (messageEl) => {
    if (!messageEl) return ''
    const classes = classText(messageEl)
    if (/(voice|audio|card--sound)/.test(classes) || messageEl.querySelector('[class*="voice"],[class*="audio"],[class*="card--sound"],audio')) return 'sent a voice message'
    if (/(file|attach|document)/.test(classes) || messageEl.querySelector('[class*="file"],[class*="attach"],[class*="document"]')) {
      const fileName = firstText(messageEl, ['[class*="file"]', '[class*="document"]'])
      return fileName ? `sent file: ${fileName}` : 'sent a file'
    }
    if (/(video)/.test(classes) || messageEl.querySelector('video')) return 'sent a video'
    if (messageEl.matches('.chatImageMessage,.chatImageMessage--audit') || messageEl.querySelector('img')) return 'sent an image'
    return ''
  }

  const messageText = (messageEl) => {
    const text = firstText(messageEl, ['span-15', 'div-15'])
    if (text) return text
    return mediaPlaceholder(messageEl)
  }

  const contextKey = (item) => [item.speaker, item.text].join('\n')

  const formatContextItem = (item) => {
    return `[${item.speaker || 'Unknown'}] ${item.text}`
  }

  const trimMemory = (convId) => {
    const items = contextMemory.get(convId) || []
    let used = 0
    const kept = []
    items.slice().reverse().forEach((item) => {
      if (kept.length >= CONTEXT_MEMORY_MESSAGE_LIMIT) return
      used += item.text.length
      if (used > CONTEXT_MEMORY_CHAR_LIMIT) return
      kept.push(item)
    })
    contextMemory.set(convId, kept.reverse())

    while (contextMemory.size > CONTEXT_MEMORY_CHAT_LIMIT) {
      contextMemory.delete(contextMemory.keys().next().value)
    }
  }

  const rememberContextItems = (convId, items) => {
    if (!convId || !items.length) return
    const existing = contextMemory.get(convId) || []
    const keys = new Set(existing.map(contextKey))
    items.forEach((item) => {
      if (!item.text || keys.has(contextKey(item))) return
      existing.push(item)
      keys.add(contextKey(item))
    })
    contextMemory.set(convId, existing)
    trimMemory(convId)
  }

  const contextItemFromElement = (messageEl) => {
    const text = messageText(messageEl)
    if (!text || isValidURL(text)) return null

    const direction = inferDirection(messageEl)
    return {
      speaker: inferSpeaker(messageEl, direction),
      direction,
      text
    }
  }

  const visibleMessageElements = () => Array.from(document.querySelectorAll(CONTEXT_MESSAGE_SELECTOR))

  const collectLocalTranslateContext = (anchorEl, currentText) => {
    if (!isLocalTranslate()) return []

    const messageEl = anchorEl && anchorEl.closest && anchorEl.closest(CONTEXT_MESSAGE_SELECTOR)
    if (!messageEl) return []

    const convId = getCurrentConvId()
    const allItems = visibleMessageElements()
      .map((el) => ({ el, item: contextItemFromElement(el) }))
      .filter(({ item }) => item)

    const selectedIndex = allItems.findIndex(({ el }) => el === messageEl)
    const selectedItem = selectedIndex >= 0 ? allItems[selectedIndex].item : contextItemFromElement(messageEl)
    const selectedKey = selectedItem ? contextKey(selectedItem) : ''
    const visibleBefore = (selectedIndex >= 0 ? allItems.slice(0, selectedIndex) : allItems)
      .map(({ item }) => item)
      .filter((item) => contextKey(item) !== selectedKey)
      .slice(-CONTEXT_VISIBLE_LIMIT)

    const visibleKeys = new Set(visibleBefore.map(contextKey))
    const memoryBefore = (contextMemory.get(convId) || [])
      .filter((item) => contextKey(item) !== selectedKey && !visibleKeys.has(contextKey(item)))
      .slice(-CONTEXT_VISIBLE_LIMIT)

    rememberContextItems(convId, allItems.map(({ item }) => item))

    return memoryBefore.concat(visibleBefore)
      .slice(-CONTEXT_VISIBLE_LIMIT)
      .map(formatContextItem)
  }

  const getLocalTranslateStatus = async () => {
    const storagePath = getLocalTranslateStoragePath()
    const query = storagePath ? `?storagePath=${encodeURIComponent(storagePath)}` : ''
    const res = await fetch(getTranslateApiURL() + '/local-translate/status' + query)
    const json = await res.json()
    if (!res.ok) {
      throw new Error(json.message || 'Không thể kiểm tra model AI')
    }
    return json
  }

  const installLocalTranslateModel = async (variantId, acceptedGemmaTerms = false) => {
    const res = await fetch(getTranslateApiURL() + '/local-translate/install', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ variantId, acceptedGemmaTerms, ...localTranslateStoragePayload() })
    })
    const json = await res.json()
    if (!res.ok || !json.success) {
      throw new Error(json.message || 'Không thể tải model AI')
    }
    return json
  }

  const getLocalOcrStatus = async () => {
    const storagePath = getLocalTranslateStoragePath()
    const query = storagePath ? `?storagePath=${encodeURIComponent(storagePath)}` : ''
    const res = await fetch(getTranslateApiURL() + '/local-ocr/status' + query)
    const json = await res.json()
    if (!res.ok) throw new Error(json.message || 'Không thể kiểm tra OCR')
    return json
  }

  const installLocalOcr = async () => {
    const res = await fetch(getTranslateApiURL() + '/local-ocr/install', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(localTranslateStoragePayload())
    })
    const json = await res.json()
    if (!res.ok || !json.success) throw new Error(json.message || 'Không thể tải OCR')
    return json
  }

  const showLocalOcrSetup = (status) => {
    return new Promise((resolve) => {
      const canInstall = status.runtimeAvailable && status.disk && status.disk.fits !== false
      const $dialog = $(`
        <div class="zadark-local-translate-dialog">
          <div class="zadark-local-translate-dialog__box">
            <div class="zadark-local-translate-dialog__title">Dịch chữ trong ảnh</div>
            <div class="zadark-local-translate-dialog__text">
              ZaDark cần tải bộ nhận dạng chữ Anh và Việt khoảng <strong>${formatBytes(status.downloadEstimatedBytes)}</strong>. Dữ liệu ảnh chỉ được xử lý trên máy của bạn.
            </div>
            <div class="zadark-local-translate-dialog__error"></div>
            <div class="zadark-local-translate-dialog__actions">
              <button type="button" class="zadark-local-translate-dialog__button" data-action="cancel">Huỷ</button>
              <button type="button" class="zadark-local-translate-dialog__button zadark-local-translate-dialog__button--primary" data-action="install" ${canInstall ? '' : 'disabled'}>Tải và tiếp tục</button>
            </div>
          </div>
        </div>
      `)
      const $error = $dialog.find('.zadark-local-translate-dialog__error')
      const finish = (value) => {
        $dialog.remove()
        resolve(value)
      }

      if (!status.runtimeAvailable) {
        $error.text('Bản ZaDark này chưa có runtime OCR.')
      } else if (status.disk && status.disk.fits === false) {
        $error.text('Ổ đĩa không đủ dung lượng trống.')
      }

      $dialog.on('click', '[data-action="cancel"]', () => finish(false))
      $dialog.on('click', '[data-action="install"]', async function () {
        const $button = $(this)
        $button.prop('disabled', true).text('Đang tải...')
        $dialog.find('[data-action="cancel"]').prop('disabled', true)
        try {
          await installLocalOcr()
          finish(true)
        } catch (error) {
          $button.prop('disabled', false).text('Thử lại')
          $dialog.find('[data-action="cancel"]').prop('disabled', false)
          $error.text(error.message)
        }
      })

      $('body').append($dialog)
    })
  }

  const ensureLocalOcrReady = async () => {
    const status = await getLocalOcrStatus()
    if (status.installed) return true
    if (status.installing) throw new Error('ZaDark đang tải bộ OCR')
    return showLocalOcrSetup(status)
  }

  const parseImageIdentity = (imageEl) => {
    if (!imageEl) return null

    const idMatch = String(imageEl.id || '').match(/^img-(\d+)\.\d+\.(g?\d+)-/)
    if (idMatch) {
      return {
        messageId: idMatch[1],
        conversationId: idMatch[2]
      }
    }

    let pathname = ''
    try {
      pathname = new URL(imageEl.currentSrc || imageEl.src || '').pathname
    } catch (error) {}
    const fileName = decodeURIComponent(pathname).split('/').pop() || ''
    const pathMatch = fileName.match(/^(\d+)_\d+_(g?\d+)(?:_|$)/)
    return pathMatch
      ? { messageId: pathMatch[1], conversationId: pathMatch[2] }
      : null
  }

  const recognizeLocalImage = async (identity) => {
    const ready = await ensureLocalOcrReady()
    if (!ready) return null

    const res = await fetch(getTranslateApiURL() + '/ocr', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ...identity,
        ...localTranslateStoragePayload()
      })
    })
    const json = await res.json()
    if (!res.ok || !json.success) throw new Error(json.message || 'Không thể nhận dạng chữ trong ảnh')
    return json
  }

  const showLocalTranslateSetup = (status) => {
    return new Promise((resolve) => {
      const selected = status.selected
      const disk = selected.disk || {}
      const totalBytes = disk.totalBytes || 0
      const freeBytes = disk.freeBytes || 0
      const usedPercent = totalBytes ? Math.min(100, ((totalBytes - freeBytes) / totalBytes) * 100) : 0
      const modelPercent = disk.modelPercent || 0
      const modelLeft = Math.min(100, usedPercent)
      const modelWidth = Math.max(2, Math.min(100 - modelLeft, modelPercent))
      const isInstalling = !!selected.installing
      const installProgress = selected.installProgress || {}
      const downloadBytes = selected.downloadEstimatedBytes || selected.estimatedBytes
      const freeAfterBytes = Math.max(0, freeBytes - downloadBytes)
      const runtimeCanInstall = selected.runtimeAvailable !== false || selected.runtimeDownloadable
      const canDownload = !isInstalling && runtimeCanInstall && selected.downloadable && disk.fits !== false
      const requiresGemmaTerms = String(selected.model || '').toLowerCase().includes('gemma')
      const installButtonText = isInstalling ? `Đang tải ${installProgress.percent || 0}%` : 'Đồng ý và tải'

      const $dialog = $(`
        <div class="zadark-local-translate-dialog">
          <div class="zadark-local-translate-dialog__box">
            <div class="zadark-local-translate-dialog__title">Dịch AI cục bộ</div>
            <div class="zadark-local-translate-dialog__text">
              Chức năng dịch này miễn phí và riêng tư vì model AI chạy trực tiếp trên máy tính của bạn.
            </div>
            <div class="zadark-local-translate-dialog__text">
              ZaDark cần tải khoảng <strong>${formatBytes(downloadBytes)}</strong>. Ổ đĩa hiện còn <strong>${formatBytes(freeBytes)}</strong>, sau khi tải còn khoảng <strong>${formatBytes(freeAfterBytes)}</strong>.
            </div>
            <div class="zadark-local-translate-dialog__text">
              Model dịch dùng Google TranslateGemma và có điều khoản sử dụng riêng.
            </div>
            ${requiresGemmaTerms
              ? `<label class="zadark-local-translate-dialog__terms">
                  <input type="checkbox" class="zadark-local-translate-dialog__terms-input">
                  <span>Tôi đã đọc và đồng ý với <a href="https://ai.google.dev/gemma/terms" target="_blank" rel="noopener noreferrer">Điều khoản sử dụng Gemma</a> và <a href="https://ai.google.dev/gemma/prohibited_use_policy" target="_blank" rel="noopener noreferrer">Chính sách sử dụng bị cấm</a>.</span>
                </label>`
              : ''}
            <div class="zadark-local-translate-dialog__disk">
              <div class="zadark-local-translate-dialog__bar">
                <div class="zadark-local-translate-dialog__bar-used" style="width: ${usedPercent}%"></div>
                <div class="zadark-local-translate-dialog__bar-model" style="left: ${modelLeft}%; width: ${modelWidth}%"></div>
              </div>
              <div class="zadark-local-translate-dialog__disk-meta">
                <span>Model AI: ${formatBytes(downloadBytes)}</span>
                <span>Còn lại sau tải: ${formatBytes(freeAfterBytes)}</span>
              </div>
            </div>
            <div class="zadark-local-translate-dialog__error"></div>
            <div class="zadark-local-translate-dialog__actions">
              <button type="button" class="zadark-local-translate-dialog__button" data-action="cancel">Huỷ</button>
              <button type="button" class="zadark-local-translate-dialog__button zadark-local-translate-dialog__button--primary" data-action="install" ${canDownload && !requiresGemmaTerms ? '' : 'disabled'}>${installButtonText}</button>
            </div>
          </div>
        </div>
      `)

      let pollTimer = null
      const finish = (value) => {
        if (pollTimer) clearInterval(pollTimer)
        $dialog.remove()
        resolve(value)
      }

      const pollInstallProgress = ($button) => {
        pollTimer = setInterval(async () => {
          try {
            const status = await getLocalTranslateStatus()
            if (status.selected && status.selected.installed && status.selected.runtimeAvailable !== false) {
              finish(true)
              return
            }

            const progress = status.selected && status.selected.installProgress
            if (progress && progress.percent) {
              $button.text(`Đang tải ${progress.percent}%`)
            }
          } catch (error) {
            $error.text(error.message)
          }
        }, 1000)
      }

      const $error = $dialog.find('.zadark-local-translate-dialog__error')
      const updateInstallButton = () => {
        const accepted = !requiresGemmaTerms || $dialog.find('.zadark-local-translate-dialog__terms-input').prop('checked')
        $dialog.find('[data-action="install"]').prop('disabled', !canDownload || !accepted)
      }
      if (!selected.downloadable) {
        $error.text('Model AI chưa có gói tải thử nghiệm.')
      } else if (!runtimeCanInstall) {
        $error.text('Runtime AI chưa sẵn sàng trong bản thử nghiệm này.')
      } else if (disk.fits === false) {
        $error.text('Ổ đĩa này không đủ dung lượng trống.')
      }

      $dialog.on('click', '[data-action="cancel"]', () => finish(false))
      $dialog.on('change', '.zadark-local-translate-dialog__terms-input', updateInstallButton)
      $dialog.on('click', '[data-action="install"]', async function () {
        const $button = $(this)
        const acceptedGemmaTerms = !requiresGemmaTerms || $dialog.find('.zadark-local-translate-dialog__terms-input').prop('checked')
        if (!acceptedGemmaTerms) return
        $button.prop('disabled', true).text('Đang tải...')
        $dialog.find('[data-action="cancel"]').prop('disabled', true)
        $error.removeClass('zadark-local-translate-dialog__error--status').text('')
        localTranslateNotReadyMessage = 'ZaDark đang tải model dịch trong nền. Bạn có thể tiếp tục dùng Zalo.'
        installLocalTranslateModel(selected.id, acceptedGemmaTerms).catch(() => {})
        document.dispatchEvent(new CustomEvent('@ZaDark:LOCAL_TRANSLATE_INSTALLING'))
        $button.text('Đang tải trong nền...')
        $error
          .addClass('zadark-local-translate-dialog__error--status')
          .text('ZaDark đang tải model trong nền. Bạn có thể tiếp tục dùng Zalo.')
        setTimeout(() => finish('installing'), 1200)
      })

      $('body').append($dialog)
      if (isInstalling) pollInstallProgress($dialog.find('[data-action="install"]'))
    })
  }

  const ensureLocalTranslateReady = async () => {
    if (!isLocalTranslate()) return true

    const status = await getLocalTranslateStatus()
    if (status.selected && status.selected.installing) {
      const progress = status.selected.installProgress || {}
      localTranslateNotReadyMessage = `ZaDark đang tải model dịch trong nền${progress.percent ? `: ${progress.percent}%` : ''}. Bạn có thể tiếp tục dùng Zalo.`
      return 'installing'
    }

    if (status.selected && status.selected.installed) {
      if (status.selected.runtimeAvailable === false) {
        if (status.selected.runtimeDownloadable) return showLocalTranslateSetup(status)
        throw new Error(status.selected.runtimeMessage || 'Runtime dịch chưa sẵn sàng')
      }
      return true
    }

    localTranslateNotReadyMessage = 'Bạn chưa tải model AI'
    return showLocalTranslateSetup(status)
  }

  const createNdjsonParser = (onEvent) => {
    let buffer = ''

    const parseLine = (line) => {
      const trimmed = line.trim()
      if (trimmed) onEvent(JSON.parse(trimmed))
    }

    return {
      write: (text) => {
        buffer += text
        const lines = buffer.split('\n')
        buffer = lines.pop()
        lines.forEach(parseLine)
      },
      end: (text = '') => {
        buffer += text
        if (buffer) parseLine(buffer)
        buffer = ''
      }
    }
  }

  const readNdjsonEvents = async (response, onEvent) => {
    const reader = response.body.getReader()
    const decoder = new window.TextDecoder()
    const parser = createNdjsonParser(onEvent)

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        parser.write(decoder.decode(value, { stream: true }))
      }
      parser.end(decoder.decode())
    } catch (error) {
      await reader.cancel().catch(() => {})
      throw error
    } finally {
      reader.releaseLock()
    }
  }

  const streamLocalTranslate = async (text, target, context, signal, onEvent) => {
    const readiness = await ensureLocalTranslateReady()
    if (readiness !== true) return localTranslateNotReadyResult(readiness, localTranslateNotReadyMessage)

    const response = await fetch(getTranslateApiURL() + '/translate/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      signal,
      body: JSON.stringify({
        text,
        target,
        ...localTranslateStoragePayload(),
        ...(context.length ? { context } : {})
      })
    })

    if (response.status === 404 || !response.body || typeof response.body.getReader !== 'function') {
      if (response.body && typeof response.body.cancel === 'function') await response.body.cancel()
      return null
    }
    if (!response.ok) {
      let message = 'Không thể bắt đầu dịch'
      try {
        const error = await response.json()
        message = error.message || message
      } catch (error) {}
      throw new Error(message)
    }

    let result = null
    await readNdjsonEvents(response, (event) => {
      if (event.type === 'error') {
        const error = new Error(event.message || 'Luồng dịch bị gián đoạn')
        error.partial = event.partial || ''
        throw error
      }
      if (event.type === 'done') result = event
      onEvent(event)
    })

    if (!result) throw new Error('Luồng dịch kết thúc không đầy đủ')
    return result
  }

  const translate = async (text, target, context = []) => {
    try {
      const readiness = await ensureLocalTranslateReady()
      if (readiness !== true) {
        return localTranslateNotReadyResult(readiness, localTranslateNotReadyMessage)
      }

      const res = await fetch(getTranslateApiURL() + '/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text,
          target,
          ...localTranslateStoragePayload(),
          ...(isLocalTranslate() && context.length ? { context } : {})
        })
      })
      const json = await res.json()
      return json
    } catch (error) {
      return {
        success: false,
        message: error.message
      }
    }
  }

  const isValidURL = (string) => {
    const regex = /^(https?:\/\/)[\w.-]+(\.[a-z]{2,})+([/?].*)?$/i
    return regex.test(string)
  }

  /**
   *
   * @param {jQuery} $buttonWrapper Element will have "translation button" added.
   * @param {jQuery} $resultWrapper Element will have "translated content" added.
   * @param {jQuery} $text Element contains the message content to be translated.
   * @param {string} translateTarget Language to be translated into.
   * @returns
   */
  const addTranslateListener = ($buttonWrapper, $resultWrapper, $text, translateTarget, imageIdentity = null) => {
    if ($buttonWrapper.find('.zadark-translate-msg__button').length) {
      return
    }

    const text = normalizeTranslateText($text ? $text.text() : '')

    // Skip if the text is empty
    if (!text && !imageIdentity) {
      return
    }

    // Skip if the text is a URL
    if (isValidURL(text)) {
      return
    }

    const $button = $('<button>')
      .addClass('zadark-translate-msg__button')
      .toggleClass('zadark-translate-msg__button--image', !!imageIdentity)
      .attr('type', 'button')
      .attr('title', imageIdentity ? 'Dịch chữ trong ảnh' : 'Dịch tin nhắn')
      .attr('aria-label', imageIdentity ? 'Dịch chữ trong ảnh' : 'Dịch tin nhắn')
      .html('<i class="zadark-icon zadark-icon--translate"></i>')

    $button.on('click', function (e) {
      e.preventDefault()
      e.stopPropagation()

      const $prevTranslation = $resultWrapper.find('.zadark-translate-msg__content')
      const buttonEl = $button[0]

      if ($prevTranslation.length) {
        const previousController = activeTranslations.get(buttonEl)
        if (previousController) previousController.abort()
        activeTranslations.delete(buttonEl)
        $prevTranslation.remove()
        return
      }

      const $nextTranslation = $('<div>')
        .addClass('zadark-translate-msg__content')
      const $title = $('<div>').addClass('zadark-translate-msg__content__title').attr('aria-live', 'polite')
      const $titleText = $('<span>').text('Đang dịch...')
      const $output = $('<div>').addClass('zadark-translate-msg__content__stream').attr('dir', 'auto')
      $title.append($('<i>').addClass('zadark-icon zadark-icon--translate'), $titleText)
      $nextTranslation.append($title, $output)

      $resultWrapper.append($nextTranslation)

      const supportsStreaming = isLocalTranslate() && window.AbortController && window.TextDecoder
      const controller = supportsStreaming
        ? new window.AbortController()
        : { abort: () => {}, signal: undefined }
      activeTranslations.set(buttonEl, controller)
      let buffered = ''
      let rendered = ''
      let framePending = false

      const isCurrent = () => activeTranslations.get(buttonEl) === controller && $nextTranslation[0].isConnected
      const setTitle = (value) => {
        if (isCurrent()) $titleText.text(value)
      }
      const flush = () => {
        framePending = false
        if (!isCurrent()) return controller.abort()
        if (!buffered) return
        rendered += buffered
        buffered = ''
        $output.text(rendered)
      }
      const flushSoon = () => {
        if (framePending) return
        framePending = true
        requestAnimationFrame(flush)
      }
      const retry = () => {
        const $retry = $('<button>')
          .addClass('zadark-translate-msg__retry')
          .attr('type', 'button')
          .text('Thử lại')
        $retry.on('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          $nextTranslation.remove()
          $button.trigger('click')
        })
        $nextTranslation.append($retry)
      }
      const showFailure = (error) => {
        flush()
        const partial = error.partial || rendered
        $nextTranslation.addClass(partial ? 'zadark-translate-msg__content--interrupted' : 'zadark-translate-msg__content--error')
        setTitle(partial ? 'Bản dịch bị gián đoạn' : `Lỗi: ${error.message}`)
        if (partial) $output.text(partial)
        retry()
      }

      ;(async () => {
        let sourceText = text
        if (imageIdentity) {
          setTitle('Đang nhận dạng chữ...')
          const ocr = await recognizeLocalImage(imageIdentity)
          if (!ocr) {
            $nextTranslation.remove()
            return
          }
          sourceText = normalizeTranslateText(ocr.text)
          if (!sourceText) {
            setTitle('Không tìm thấy chữ trong ảnh')
            return
          }
        }

        const context = collectLocalTranslateContext($buttonWrapper[0], sourceText)
        let result

        if (supportsStreaming) {
          result = await streamLocalTranslate(sourceText, translateTarget, context, controller.signal, (event) => {
            if (event.type === 'state' && event.state === 'queued') setTitle('Đang chờ dịch...')
            if (event.type === 'state' && event.state === 'starting') setTitle('Đang khởi động model...')
            if (event.type === 'delta') {
              setTitle('Đang dịch...')
              buffered += event.text || ''
              flushSoon()
            }
          })
          if (result === null) result = await translate(sourceText, translateTarget, context)
        } else {
          result = await translate(sourceText, translateTarget, context)
        }

        if (!isCurrent()) return
        flush()
        if (!result.success) {
          if (result.pending) {
            setTitle(result.message)
            return
          }
          throw new Error(result.message)
        }

        $nextTranslation.removeClass('zadark-translate-msg__content--error zadark-translate-msg__content--interrupted')
        setTitle(result.languageName || 'Bản dịch')
        $output.text(result.translation).attr('aria-label', 'Bản dịch hoàn tất')
      })().catch((error) => {
        if (error.name !== 'AbortError' && isCurrent()) showFailure(error)
      }).finally(() => {
        if (activeTranslations.get(buttonEl) === controller) activeTranslations.delete(buttonEl)
      })
    })

    $buttonWrapper.append($button)
  }

  $.fn.enableTranslateMessage = function (translateTarget) {
    if (!translateTarget || translateTarget === 'none') {
      return
    }

    return this.each(function () {
      $(this).on('mouseenter.zadark-translate-msg', '.card', function (e) {
        const $card = $(this)
        const $content = $card
        const $text = $content.find('div > span-15, div > div-15')

        addTranslateListener($card, $content, $text, translateTarget)
      })

      $(this).on('mouseenter.zadark-translate-msg', '.chatImageMessage,.chatImageMessage--audit', function (e) {
        const $card = $(this).find('.img-msg-v2__ft')
        const $content = $(this).find('.img-msg-v2__cap')
        const $text = $content.find('span-15, div-15')

        addTranslateListener($card, $content, $text, translateTarget)
      })

      if (isLocalTranslate()) {
        $(this).on('mouseenter.zadark-translate-msg', 'img.zimg-el[data-z-element-type="image"]', function () {
          const identity = parseImageIdentity(this)
          if (!identity) return

          const $image = $(this)
          const $message = $image.closest('.chatImageMessage,.chatImageMessage--audit')
          if (!$message.length) return

          const $anchor = $image.parent().addClass('zadark-ocr-image-anchor')
          addTranslateListener($anchor, $message, null, translateTarget, identity)
        })
      }
    })
  }

  $.fn.disableTranslateMessage = function () {
    return this.each(function () {
      // Remove event listener
      $(this).off('mouseenter.zadark-translate-msg')

      // Remove translate button
      $(this).find('.zadark-translate-msg__button').remove()
    })
  }

  window.ZaDarkTranslateContext = {
    collectLocalTranslateContext,
    contextItemFromElement,
    formatContextItem,
    createNdjsonParser,
    parseImageIdentity,
    localTranslateNotReadyResult,
    rememberContextItems,
    reset: () => contextMemory.clear()
  }

  document.addEventListener('@ZaDark:CONV_ID_CHANGE', () => {
    activeTranslations.forEach((controller) => controller.abort())
    activeTranslations.clear()
  })

  const LANGUAGES = [
    {
      code: 'ar',
      name: 'Ả Rập'
    },
    {
      code: 'sq',
      name: 'Albania'
    },
    {
      code: 'am',
      name: 'Amharic'
    },
    {
      code: 'en',
      name: 'Anh'
    },
    {
      code: 'hy',
      name: 'Armenia'
    },
    {
      code: 'as',
      name: 'Assam'
    },
    {
      code: 'ay',
      name: 'Aymara'
    },
    {
      code: 'az',
      name: 'Azerbaijan'
    },
    {
      code: 'pl',
      name: 'Ba Lan'
    },
    {
      code: 'fa',
      name: 'Ba Tư'
    },
    {
      code: 'bm',
      name: 'Bambara'
    },
    {
      code: 'xh',
      name: 'Bantu'
    },
    {
      code: 'eu',
      name: 'Basque'
    },
    {
      code: 'nso',
      name: 'Bắc Sotho'
    },
    {
      code: 'be',
      name: 'Belarus'
    },
    {
      code: 'bn',
      name: 'Bengal'
    },
    {
      code: 'bho',
      name: 'Bhojpuri'
    },
    {
      code: 'bs',
      name: 'Bosnia'
    },
    {
      code: 'pt',
      name: 'Bồ Đào Nha'
    },
    {
      code: 'bg',
      name: 'Bulgaria'
    },
    {
      code: 'ca',
      name: 'Catalan'
    },
    {
      code: 'ceb',
      name: 'Cebuano'
    },
    {
      code: 'ny',
      name: 'Chichewa'
    },
    {
      code: 'co',
      name: 'Corsi'
    },
    {
      code: 'ht',
      name: 'Creole (Haiti)'
    },
    {
      code: 'hr',
      name: 'Croatia'
    },
    {
      code: 'dv',
      name: 'Divehi'
    },
    {
      code: 'iw',
      name: 'Do Thái'
    },
    {
      code: 'doi',
      name: 'Dogri'
    },
    {
      code: 'da',
      name: 'Đan Mạch'
    },
    {
      code: 'de',
      name: 'Đức'
    },
    {
      code: 'et',
      name: 'Estonia'
    },
    {
      code: 'ee',
      name: 'Ewe'
    },
    {
      code: 'tl',
      name: 'Filipino'
    },
    {
      code: 'fy',
      name: 'Frisia'
    },
    {
      code: 'gd',
      name: 'Gael Scotland'
    },
    {
      code: 'gl',
      name: 'Galicia'
    },
    {
      code: 'ka',
      name: 'George'
    },
    {
      code: 'gn',
      name: 'Guarani'
    },
    {
      code: 'gu',
      name: 'Gujarat'
    },
    {
      code: 'nl',
      name: 'Hà Lan'
    },
    {
      code: 'af',
      name: 'Hà Lan (Nam Phi)'
    },
    {
      code: 'ko',
      name: 'Hàn'
    },
    {
      code: 'ha',
      name: 'Hausa'
    },
    {
      code: 'haw',
      name: 'Hawaii'
    },
    {
      code: 'hi',
      name: 'Hindi'
    },
    {
      code: 'hmn',
      name: 'Hmong'
    },
    {
      code: 'hu',
      name: 'Hungary'
    },
    {
      code: 'el',
      name: 'Hy Lạp'
    },
    {
      code: 'is',
      name: 'Iceland'
    },
    {
      code: 'ig',
      name: 'Igbo'
    },
    {
      code: 'ilo',
      name: 'Iloko'
    },
    {
      code: 'id',
      name: 'Indonesia'
    },
    {
      code: 'ga',
      name: 'Ireland'
    },
    {
      code: 'jw',
      name: 'Java'
    },
    {
      code: 'kn',
      name: 'Kannada'
    },
    {
      code: 'kk',
      name: 'Kazakh'
    },
    {
      code: 'km',
      name: 'Khmer'
    },
    {
      code: 'rw',
      name: 'Kinyarwanda'
    },
    {
      code: 'gom',
      name: 'Konkani'
    },
    {
      code: 'kri',
      name: 'Krio'
    },
    {
      code: 'ku',
      name: 'Kurd (Kurmanji)'
    },
    {
      code: 'ckb',
      name: 'Kurd (Sorani)'
    },
    {
      code: 'ky',
      name: 'Kyrgyz'
    },
    {
      code: 'lo',
      name: 'Lào'
    },
    {
      code: 'la',
      name: 'Latinh'
    },
    {
      code: 'lv',
      name: 'Latvia'
    },
    {
      code: 'ln',
      name: 'Lingala'
    },
    {
      code: 'lt',
      name: 'Litva'
    },
    {
      code: 'lb',
      name: 'Luxembourg'
    },
    {
      code: 'ms',
      name: 'Mã Lai'
    },
    {
      code: 'mk',
      name: 'Macedonia'
    },
    {
      code: 'mai',
      name: 'Maithili'
    },
    {
      code: 'mg',
      name: 'Malagasy'
    },
    {
      code: 'ml',
      name: 'Malayalam'
    },
    {
      code: 'mt',
      name: 'Malta'
    },
    {
      code: 'mi',
      name: 'Maori'
    },
    {
      code: 'mr',
      name: 'Marathi'
    },
    {
      code: 'mni-Mtei',
      name: 'Meiteilon (Manipuri)'
    },
    {
      code: 'lus',
      name: 'Mizo'
    },
    {
      code: 'mn',
      name: 'Mông Cổ'
    },
    {
      code: 'my',
      name: 'Myanmar'
    },
    {
      code: 'no',
      name: 'Na Uy'
    },
    {
      code: 'ne',
      name: 'Nepal'
    },
    {
      code: 'ru',
      name: 'Nga'
    },
    {
      code: 'ja',
      name: 'Nhật'
    },
    {
      code: 'or',
      name: 'Odia (Oriya)'
    },
    {
      code: 'om',
      name: 'Oromo'
    },
    {
      code: 'ps',
      name: 'Pashto'
    },
    {
      code: 'sa',
      name: 'Phạn'
    },
    {
      code: 'fr',
      name: 'Pháp'
    },
    {
      code: 'fi',
      name: 'Phần Lan'
    },
    {
      code: 'pa',
      name: 'Punjab'
    },
    {
      code: 'qu',
      name: 'Quechua'
    },
    {
      code: 'eo',
      name: 'Quốc tế ngữ'
    },
    {
      code: 'ro',
      name: 'Rumani'
    },
    {
      code: 'sm',
      name: 'Samoa'
    },
    {
      code: 'cs',
      name: 'Séc'
    },
    {
      code: 'sr',
      name: 'Serbia'
    },
    {
      code: 'st',
      name: 'Sesotho'
    },
    {
      code: 'sn',
      name: 'Shona'
    },
    {
      code: 'sd',
      name: 'Sindhi'
    },
    {
      code: 'si',
      name: 'Sinhala'
    },
    {
      code: 'sk',
      name: 'Slovak'
    },
    {
      code: 'sl',
      name: 'Slovenia'
    },
    {
      code: 'so',
      name: 'Somali'
    },
    {
      code: 'su',
      name: 'Sunda'
    },
    {
      code: 'sw',
      name: 'Swahili'
    },
    {
      code: 'tg',
      name: 'Tajik'
    },
    {
      code: 'ta',
      name: 'Tamil'
    },
    {
      code: 'tt',
      name: 'Tatar'
    },
    {
      code: 'es',
      name: 'Tây Ban Nha'
    },
    {
      code: 'te',
      name: 'Telugu'
    },
    {
      code: 'th',
      name: 'Thái'
    },
    {
      code: 'tr',
      name: 'Thổ Nhĩ Kỳ'
    },
    {
      code: 'sv',
      name: 'Thụy Điển'
    },
    {
      code: 'lg',
      name: 'Tiếng Ganda'
    },
    {
      code: 'ti',
      name: 'Tigrinya'
    },
    {
      code: 'zh',
      name: 'Trung (Giản thể)'
    },
    {
      code: 'zh-TW',
      name: 'Trung (Phồn thể)'
    },
    {
      code: 'ts',
      name: 'Tsonga'
    },
    {
      code: 'tk',
      name: 'Turkmen'
    },
    {
      code: 'ak',
      name: 'Twi'
    },
    {
      code: 'uk',
      name: 'Ukraina'
    },
    {
      code: 'ur',
      name: 'Urdu'
    },
    {
      code: 'ug',
      name: 'Uyghur'
    },
    {
      code: 'uz',
      name: 'Uzbek'
    },
    {
      code: 'vi',
      name: 'Việt'
    },
    {
      code: 'cy',
      name: 'Xứ Wales'
    },
    {
      code: 'it',
      name: 'Ý'
    },
    {
      code: 'yi',
      name: 'Yiddish'
    },
    {
      code: 'yo',
      name: 'Yoruba'
    },
    {
      code: 'zu',
      name: 'Zulu'
    },
    {
      code: 'he',
      name: 'Do Thái'
    },
    {
      code: 'jv',
      name: 'Java'
    },
    {
      code: 'zh-CN',
      name: 'Trung (Giản thể)'
    }
  ]

  $.fn.setLanguagesOptions = function (defaultLanguage = 'vi') {
    return this.each(function () {
      const $selectEl = $(this)

      $selectEl.empty()
      $selectEl.append($('<option>').val('none').text('Tắt'))

      LANGUAGES.forEach(function (language) {
        const option = $('<option>').val(language.code).text(`Tiếng ${language.name}`)
        $selectEl.append(option)
      })

      $selectEl.val(defaultLanguage)
    })
  }
})(jQuery)
