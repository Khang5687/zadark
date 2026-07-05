const fs = require('fs')
const path = require('path')

function loadTranslateContext () {
  window.jQuery = function () {}
  window.jQuery.fn = {}
  window.$ = window.jQuery
  window.DEBUG = false
  window.ZADARK_API_URL = 'https://api.zadark.test/v1'
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'src/core/js/zadark-translate.js'), 'utf8'))
  window.ZaDarkTranslateContext.reset()
  document.body.className = 'zadark-pc'
  document.body.setAttribute('data-current-conv-id', 'conv-a')
}

describe('local translate context', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    loadTranslateContext()
  })

  it('formats group context with speakers and excludes the selected message', () => {
    document.body.innerHTML = `
      <div class="card incoming" data-sender-name="Alice"><span-15>I sent it to Minh yesterday.</span-15></div>
      <div class="card outgoing"><span-15>Did he confirm?</span-15></div>
      <div class="card incoming" data-sender-name="Bob"><span-15>He said yes.</span-15></div>
    `

    const selected = document.querySelectorAll('.card')[2]
    const context = window.ZaDarkTranslateContext.collectLocalTranslateContext(selected, 'He said yes.')

    expect(context).toEqual([
      '[Alice] I sent it to Minh yesterday.',
      '[Me] Did he confirm?'
    ])
  })

  it('keeps a bounded per-chat memory after older visible messages disappear', () => {
    document.body.innerHTML = `
      <div class="card incoming" data-sender-name="Alice"><span-15>Passport is with Minh.</span-15></div>
      <div class="card outgoing"><span-15>Can you ask him?</span-15></div>
    `

    window.ZaDarkTranslateContext.collectLocalTranslateContext(document.querySelectorAll('.card')[1], 'Can you ask him?')

    document.body.innerHTML = `
      <div class="card incoming" data-sender-name="Alice"><span-15>Did he return it?</span-15></div>
    `

    const context = window.ZaDarkTranslateContext.collectLocalTranslateContext(document.querySelector('.card'), 'Did he return it?')

    expect(context).toContain('[Alice] Passport is with Minh.')
    expect(context).toContain('[Me] Can you ask him?')
    expect(context).not.toContain('[Alice] Did he return it?')
  })

  it('keeps context isolated by conversation id', () => {
    document.body.innerHTML = `
      <div class="card incoming" data-sender-name="Alice"><span-15>Context from chat A.</span-15></div>
      <div class="card outgoing"><span-15>Reply A.</span-15></div>
    `
    window.ZaDarkTranslateContext.collectLocalTranslateContext(document.querySelectorAll('.card')[1], 'Reply A.')

    document.body.setAttribute('data-current-conv-id', 'conv-b')
    document.body.innerHTML = `
      <div class="card incoming" data-sender-name="Bob"><span-15>Current chat B.</span-15></div>
    `

    const context = window.ZaDarkTranslateContext.collectLocalTranslateContext(document.querySelector('.card'), 'Current chat B.')

    expect(context).toEqual([])
  })

  it('keeps earlier same-text context from a different speaker', () => {
    document.body.innerHTML = `
      <div class="card incoming" data-sender-name="Alice"><span-15>Okay.</span-15></div>
      <div class="card outgoing"><span-15>Okay.</span-15></div>
    `

    const context = window.ZaDarkTranslateContext.collectLocalTranslateContext(document.querySelectorAll('.card')[1], 'Okay.')

    expect(context).toEqual(['[Alice] Okay.'])
  })

  it('caps visible context to the last 12 messages before the selected message', () => {
    document.body.innerHTML = Array.from({ length: 14 }, (_, index) => {
      return `<div class="card incoming" data-sender-name="Alice"><span-15>Message ${index}</span-15></div>`
    }).join('') + '<div class="card incoming" data-sender-name="Alice"><span-15>Selected</span-15></div>'

    const cards = document.querySelectorAll('.card')
    const context = window.ZaDarkTranslateContext.collectLocalTranslateContext(cards[cards.length - 1], 'Selected')

    expect(context).toHaveLength(12)
    expect(context[0]).toBe('[Alice] Message 2')
    expect(context[11]).toBe('[Alice] Message 13')
  })

  it('reads newer Zalo div-15 text nodes', () => {
    document.body.innerHTML = '<div class="card incoming" data-sender-name="Alice"><div-15>New text node.</div-15></div>'

    expect(window.ZaDarkTranslateContext.formatContextItem(window.ZaDarkTranslateContext.contextItemFromElement(document.querySelector('.card')))).toBe('[Alice] New text node.')
  })

  it('uses media placeholders when captions are unavailable', () => {
    const image = document.createElement('div')
    image.className = 'chatImageMessage incoming'
    image.setAttribute('data-sender-name', 'Alice')
    image.innerHTML = '<img alt="">'

    const voice = document.createElement('div')
    voice.className = 'card incoming voice-message'
    voice.setAttribute('data-sender-name', 'Bob')

    expect(window.ZaDarkTranslateContext.formatContextItem(window.ZaDarkTranslateContext.contextItemFromElement(image))).toBe('[Alice] sent an image')
    expect(window.ZaDarkTranslateContext.formatContextItem(window.ZaDarkTranslateContext.contextItemFromElement(voice))).toBe('[Bob] sent a voice message')
  })

  it('uses Zalo-like React props for direction and speaker when available', () => {
    const incoming = document.createElement('div')
    incoming.className = 'card'
    incoming.innerHTML = '<span-15>Hello</span-15>'
    incoming.__reactFiberTest = {
      memoizedProps: {
        senderName: 'Minh',
        data: { fromUid: '123' }
      }
    }

    const outgoing = document.createElement('div')
    outgoing.className = 'card'
    outgoing.innerHTML = '<span-15>Hi</span-15>'
    outgoing.__reactFiberTest = {
      memoizedProps: {
        data: { fromUid: '0' }
      }
    }

    expect(window.ZaDarkTranslateContext.formatContextItem(window.ZaDarkTranslateContext.contextItemFromElement(incoming))).toBe('[Minh] Hello')
    expect(window.ZaDarkTranslateContext.formatContextItem(window.ZaDarkTranslateContext.contextItemFromElement(outgoing))).toBe('[Me] Hi')
  })

  it('uses wrapper message classes and sender names around inner cards', () => {
    document.body.innerHTML = `
      <div class="chat-message me">
        <div class="card"><span-15>My wrapped message.</span-15></div>
      </div>
      <div class="chat-message" data-sender-name="Ngoc">
        <div class="card"><span-15>Wrapped incoming.</span-15></div>
      </div>
    `

    const cards = document.querySelectorAll('.card')

    expect(window.ZaDarkTranslateContext.formatContextItem(window.ZaDarkTranslateContext.contextItemFromElement(cards[0]))).toBe('[Me] My wrapped message.')
    expect(window.ZaDarkTranslateContext.formatContextItem(window.ZaDarkTranslateContext.contextItemFromElement(cards[1]))).toBe('[Ngoc] Wrapped incoming.')
  })

  it('treats Zalo sound cards as voice messages', () => {
    const sound = document.createElement('div')
    sound.className = 'card card--sound'
    sound.setAttribute('data-sender-name', 'Lan')

    expect(window.ZaDarkTranslateContext.formatContextItem(window.ZaDarkTranslateContext.contextItemFromElement(sound))).toBe('[Lan] sent a voice message')
  })

  it('treats an active model download as pending instead of an error', () => {
    expect(window.ZaDarkTranslateContext.localTranslateNotReadyResult('installing', 'Đang tải')).toEqual({
      success: false,
      pending: true,
      message: 'Đang tải'
    })
    expect(window.ZaDarkTranslateContext.localTranslateNotReadyResult(false, 'Chưa tải')).toEqual({
      success: false,
      pending: false,
      message: 'Chưa tải'
    })
  })

  it('parses cached Zalo image identities without trusting arbitrary paths', () => {
    const image = document.createElement('img')
    image.id = 'img-1783263115819.252609586847894308.3099821550516528801-main'

    expect(window.ZaDarkTranslateContext.parseImageIdentity(image)).toEqual({
      messageId: '1783263115819',
      conversationId: '3099821550516528801'
    })

    image.id = ''
    image.src = 'file:///tmp/1783245078009_123_g3153313052979372135_hash_n'
    expect(window.ZaDarkTranslateContext.parseImageIdentity(image)).toEqual({
      messageId: '1783245078009',
      conversationId: 'g3153313052979372135'
    })

    image.src = 'file:///tmp/not-zalo-media.jpg'
    expect(window.ZaDarkTranslateContext.parseImageIdentity(image)).toBeNull()
  })

  it('does not send unrelated chat context with image OCR text', () => {
    document.body.innerHTML = `
      <div class="card incoming" data-sender-name="Alice"><span-15>Unrelated private message.</span-15></div>
      <div class="chatImageMessage"><img></div>
    `

    const imageMessage = document.querySelector('.chatImageMessage')
    expect(window.ZaDarkTranslateContext.collectTranslationContext(
      imageMessage,
      'Recognized image text',
      { messageId: '1', conversationId: '2' }
    )).toEqual([])
  })

  it('enables optional AI footnotes by default and respects opt-out', () => {
    localStorage.removeItem('@ZaDark:TRANSLATE_FOOTNOTES')
    expect(window.ZaDarkTranslateContext.isTranslateFootnotesEnabled()).toBe(true)

    localStorage.setItem('@ZaDark:TRANSLATE_FOOTNOTES', 'false')
    expect(window.ZaDarkTranslateContext.isTranslateFootnotesEnabled()).toBe(false)
  })

  it('sends the explicitly selected local model with translation requests', () => {
    localStorage.removeItem('@ZaDark:LOCAL_TRANSLATE_VARIANT')
    expect(window.ZaDarkTranslateContext.localTranslateStoragePayload()).toEqual({})

    localStorage.setItem('@ZaDark:LOCAL_TRANSLATE_VARIANT', 'macos-arm64-llamacpp-translategemma-12b-q4')
    expect(window.ZaDarkTranslateContext.localTranslateStoragePayload()).toEqual({
      variantId: 'macos-arm64-llamacpp-translategemma-12b-q4'
    })
  })

  it('parses fragmented and combined NDJSON stream events', () => {
    const events = []
    const parser = window.ZaDarkTranslateContext.createNdjsonParser((event) => events.push(event))

    parser.write('{"type":"delta","text":"Xin')
    parser.write(' chào"}\n{"type":"delta","text":" bạn"}\n{"type":"do')
    parser.end('ne","translation":"Xin chào bạn"}\n')

    expect(events).toEqual([
      { type: 'delta', text: 'Xin chào' },
      { type: 'delta', text: ' bạn' },
      { type: 'done', translation: 'Xin chào bạn' }
    ])
  })
})
