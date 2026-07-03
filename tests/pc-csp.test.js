const HTMLParser = require('node-html-parser')
const zadarkPC = require('../src/pc/zadark-pc')

describe('pc content security policy', () => {
  it('allows the local translate backend', () => {
    const root = HTMLParser.parse(`
      <head>
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'self' https://zalo.me">
      </head>
    `)

    zadarkPC.updateMetaContentSecurityPolicyTag(root)

    const content = root.querySelector('meta').getAttribute('content')
    expect(content).toContain('http://127.0.0.1:*')
    expect(content).toContain('http://localhost:*')
  })
})
