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

  it('treats Zalo sound cards as voice messages', () => {
    const sound = document.createElement('div')
    sound.className = 'card card--sound'
    sound.setAttribute('data-sender-name', 'Lan')

    expect(window.ZaDarkTranslateContext.formatContextItem(window.ZaDarkTranslateContext.contextItemFromElement(sound))).toBe('[Lan] sent a voice message')
  })
})
