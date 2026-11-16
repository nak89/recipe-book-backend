import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchTikTokCaption } from '../lib/tiktokCaption.js'

const shortUrl = 'https://vt.tiktok.com/ZSpg7kHad/'
const postId = '7551508670773759262'
const postUrl = `https://www.tiktok.com/@mooney7066/video/${postId}`
const caption = 'Marinade: ⅛ cup soy sauce\nGlaze: ⅓ cup soy sauce'

function postResponse(id: string) {
  const data = {
    __DEFAULT_SCOPE__: {
      'webapp.video-detail': { itemInfo: { itemStruct: { id, desc: caption } } },
    },
  }
  return new Response(
    `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(data)}</script>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

test('resolves a TikTok share URL and returns the complete measured caption', async context => {
  const fetch = context.mock.method(globalThis, 'fetch', async (url: URL, options: RequestInit) => {
    assert.equal(options.redirect, 'manual')
    return url.href === shortUrl ? Response.redirect(postUrl + '?_t=tracking', 301) : postResponse(postId)
  })
  assert.equal(await fetchTikTokCaption(shortUrl, new AbortController().signal), caption)
  assert.deepEqual(fetch.mock.calls.map(call => String(call.arguments[0])), [shortUrl, postUrl])
})

test('does not fetch a non-TikTok redirect or an unsupported TikTok path', async context => {
  const fetch = context.mock.method(globalThis, 'fetch', async () => Response.redirect('https://example.org', 302))
  const { signal } = new AbortController()
  assert.equal(await fetchTikTokCaption('https://www.tiktok.com/@cook', signal), undefined)
  assert.equal(await fetchTikTokCaption('https://vt.tiktok.com.example.org/short', signal), undefined)
  assert.equal(fetch.mock.callCount(), 0)
  assert.equal(await fetchTikTokCaption(shortUrl, signal), undefined)
  assert.equal(fetch.mock.callCount(), 1)
})

test('falls back when the page lacks matching video data', async context => {
  const fetch = context.mock.method(globalThis, 'fetch', async () => postResponse('123'))
  const { signal } = new AbortController()
  assert.equal(await fetchTikTokCaption(postUrl, signal), undefined)
  fetch.mock.mockImplementation(async () => Response.json({ error: 'Unavailable' }, { status: 403 }))
  assert.equal(await fetchTikTokCaption(postUrl, signal), undefined)
})
