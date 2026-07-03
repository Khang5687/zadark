(function ($) {
  const ZADARK_LOCAL_TRANSLATE_STORAGE_PATH_KEY = '@ZaDark:LOCAL_TRANSLATE_STORAGE_PATH'

  const getTranslateApiURL = () => {
    if (document.body.classList.contains('zadark-pc')) {
      return 'http://127.0.0.1:5555/v1'
    }

    return ZADARK_API_URL
  }

  const isLocalTranslate = () => document.body.classList.contains('zadark-pc')

  const getLocalTranslateStoragePath = () => {
    return localStorage.getItem(ZADARK_LOCAL_TRANSLATE_STORAGE_PATH_KEY) || ''
  }

  const localTranslateStoragePayload = () => {
    const storagePath = getLocalTranslateStoragePath()
    return storagePath ? { storagePath } : {}
  }

  const formatBytes = (bytes) => {
    if (!bytes) return '0 GB'
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
  }

  const normalizeTranslateText = (text) => String(text || '').replace(/(?:\r\n|\r|\n)/g, '<br>').trim()

  const normalizeContextText = (text) => String(text || '').replace(/\s+/g, ' ').trim()

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

  const installLocalTranslateModel = async (variantId) => {
    const res = await fetch(getTranslateApiURL() + '/local-translate/install', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ variantId, ...localTranslateStoragePayload() })
    })
    const json = await res.json()
    if (!res.ok || !json.success) {
      throw new Error(json.message || 'Không thể tải model AI')
    }
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
      const canDownload = !isInstalling && selected.runtimeAvailable !== false && selected.downloadable && disk.fits !== false
      const installButtonText = isInstalling ? `Đang tải ${installProgress.percent || 0}%` : 'Tải model AI'

      const $dialog = $(`
        <div class="zadark-local-translate-dialog">
          <div class="zadark-local-translate-dialog__box">
            <div class="zadark-local-translate-dialog__title">Dịch AI cục bộ</div>
            <div class="zadark-local-translate-dialog__text">
              Dịch tin nhắn miễn phí và riêng tư. Model AI sẽ chạy trực tiếp trên máy tính của bạn.
            </div>
            <div class="zadark-local-translate-dialog__text">
              ZaDark cần tải khoảng <strong>${formatBytes(selected.estimatedBytes)}</strong> dữ liệu AI. Ổ đĩa này sẽ dùng thêm khoảng <strong>${modelPercent}%</strong> dung lượng.
            </div>
            <div class="zadark-local-translate-dialog__disk">
              <div class="zadark-local-translate-dialog__bar">
                <div class="zadark-local-translate-dialog__bar-used" style="width: ${usedPercent}%"></div>
                <div class="zadark-local-translate-dialog__bar-model" style="left: ${modelLeft}%; width: ${modelWidth}%"></div>
              </div>
              <div class="zadark-local-translate-dialog__disk-meta">
                <span>Còn trống: ${formatBytes(freeBytes)}</span>
                <span>Model AI: ${formatBytes(selected.estimatedBytes)}</span>
              </div>
            </div>
            <div class="zadark-local-translate-dialog__error"></div>
            <div class="zadark-local-translate-dialog__actions">
              <button type="button" class="zadark-local-translate-dialog__button" data-action="cancel">Huỷ</button>
              <button type="button" class="zadark-local-translate-dialog__button zadark-local-translate-dialog__button--primary" data-action="install" ${canDownload ? '' : 'disabled'}>${installButtonText}</button>
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
            if (status.selected && status.selected.installed) {
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
      if (!selected.downloadable) {
        $error.text('Model AI chưa có gói tải thử nghiệm.')
      } else if (selected.runtimeAvailable === false) {
        $error.text('Runtime AI chưa sẵn sàng trong bản thử nghiệm này.')
      } else if (disk.fits === false) {
        $error.text('Ổ đĩa này không đủ dung lượng trống.')
      }

      $dialog.on('click', '[data-action="cancel"]', () => finish(false))
      $dialog.on('click', '[data-action="install"]', async function () {
        const $button = $(this)
        $button.prop('disabled', true).text('Đang tải...')
        $dialog.find('[data-action="cancel"]').prop('disabled', true)
        $error.text('')
        pollInstallProgress($button)
        try {
          await installLocalTranslateModel(selected.id)
          finish(true)
        } catch (error) {
          if (pollTimer) clearInterval(pollTimer)
          $button.prop('disabled', false).text('Tải model AI')
          $dialog.find('[data-action="cancel"]').prop('disabled', false)
          $error.text(error.message)
        }
      })

      $('body').append($dialog)
      if (isInstalling) pollInstallProgress($dialog.find('[data-action="install"]'))
    })
  }

  const ensureLocalTranslateReady = async () => {
    if (!isLocalTranslate()) return true

    const status = await getLocalTranslateStatus()
    if (status.selected && status.selected.installed) {
      if (status.selected.runtimeAvailable === false) {
        throw new Error(status.selected.runtimeMessage || 'Runtime dịch chưa sẵn sàng')
      }
      return true
    }

    return showLocalTranslateSetup(status)
  }

  const translate = async (text, target, context = []) => {
    try {
      const isReady = await ensureLocalTranslateReady()
      if (!isReady) {
        return {
          success: false,
          message: 'Bạn chưa tải model AI'
        }
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

  const collectLocalTranslateContext = ($anchor, currentText) => {
    if (!isLocalTranslate()) return []

    const $message = $anchor.closest('.card,.chatImageMessage,.chatImageMessage--audit')
    if (!$message.length) return []

    const context = []
    const currentContextText = normalizeContextText(currentText)
    $message.prevAll('.card,.chatImageMessage,.chatImageMessage--audit').each(function () {
      if (context.length >= 10) return false

      const text = normalizeContextText($(this).find('span-15').first().text())
      if (!text || text === currentContextText || isValidURL(text)) return

      context.push(text)
    })

    return context.reverse()
  }

  /**
   *
   * @param {jQuery} $buttonWrapper Element will have "translation button" added.
   * @param {jQuery} $resultWrapper Element will have "translated content" added.
   * @param {jQuery} $text Element contains the message content to be translated.
   * @param {string} translateTarget Language to be translated into.
   * @returns
   */
  const addTranslateListener = ($buttonWrapper, $resultWrapper, $text, translateTarget) => {
    if ($buttonWrapper.find('.zadark-translate-msg__button').length) {
      return
    }

    const text = normalizeTranslateText($text ? $text.text() : '')

    // Skip if the text is empty
    if (!text) {
      return
    }

    // Skip if the text is a URL
    if (isValidURL(text)) {
      return
    }

    const $button = $('<button>')
      .addClass('zadark-translate-msg__button')
      .html('<i class="zadark-icon zadark-icon--translate"></i>')

    $button.on('click', function (e) {
      e.preventDefault()
      e.stopPropagation()

      const $prevTranslation = $resultWrapper.find('.zadark-translate-msg__content')

      if ($prevTranslation.length) {
        $prevTranslation.remove()
        return
      }

      const $nextTranslation = $('<div>')
        .addClass('zadark-translate-msg__content')
        .html(`
            <div class="zadark-translate-msg__content__title">
              <i class="zadark-icon zadark-icon--translate"></i>
              Đang dịch ...
            </div>
          `)

      $resultWrapper.append($nextTranslation)

      translate(text, translateTarget, collectLocalTranslateContext($buttonWrapper, text)).then((res) => {
        if (!res.success) {
          $nextTranslation
            .addClass('zadark-translate-msg__content--error')
            .html('Lỗi: ' + res.message)
          return
        }

        $nextTranslation
          .html(`
              <div class="zadark-translate-msg__content__title">
                <i class="zadark-icon zadark-icon--translate"></i>
                ${res.languageName}
              </div>
              <div>${res.translation}</div>
            `)
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
        const $text = $content.find('div > span-15')

        addTranslateListener($card, $content, $text, translateTarget)
      })

      $(this).on('mouseenter.zadark-translate-msg', '.chatImageMessage,.chatImageMessage--audit', function (e) {
        const $card = $(this).find('.img-msg-v2__ft')
        const $content = $(this).find('.img-msg-v2__cap')
        const $text = $content.find('span-15')

        addTranslateListener($card, $content, $text, translateTarget)
      })
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
