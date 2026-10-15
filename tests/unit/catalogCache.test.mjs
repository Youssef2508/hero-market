import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCatalogCache } from '../../src/renderer/src/lib/catalogCache.js'

/** A fake service: counts calls; version and data can be changed by the test. */
function fakeApi() {
  const state = { version: 1, calls: [], names: { 1: 'ألبان', 2: 'مشروبات' } }
  const api = async (op, body = {}) => {
    state.calls.push(op)
    if (op === 'pos.catalogVersion') return { version: state.version }
    if (op === 'pos.categories')
      return {
        version: state.version,
        categories: [
          { id: 1, name: state.names[1], products: 3 },
          { id: 2, name: state.names[2], products: 450 }
        ],
        uncategorised: 1
      }
    if (op === 'pos.categoryProducts') {
      const total = body.categoryId === 2 ? 450 : 3
      const offset = body.offset || 0
      const n = Math.min(200, total - offset)
      return {
        version: state.version,
        products: Array.from({ length: n }, (_, i) => ({
          barcode: `${body.categoryId}-${offset + i}`,
          name: `p${offset + i}`,
          price: 10 * state.version
        })),
        more: offset + n < total
      }
    }
    throw new Error(op)
  }
  return { api, state }
}

test('switching between categories already opened needs no product query', async () => {
  let t = 0
  const { api, state } = fakeApi()
  const cache = createCatalogCache(api, { now: () => t })
  await cache.categories()
  await cache.products(1)
  await cache.products(2)
  const before = state.calls.filter((c) => c === 'pos.categoryProducts').length
  t += 1000
  for (let i = 0; i < 10; i++) {
    await cache.products(1)
    await cache.products(2)
  }
  assert.equal(state.calls.filter((c) => c === 'pos.categoryProducts').length, before)
  assert.equal(cache.stats.hits >= 20, true)
})

test('a catalogue change is picked up at the next check; nothing older is served after it', async () => {
  let t = 0
  const { api, state } = fakeApi()
  const cache = createCatalogCache(api, { maxAgeMs: 30000, now: () => t })
  assert.equal((await cache.products(1)).products[0].price, 10)
  state.version = 2 // an administrator changed a price
  t += 10000
  assert.equal((await cache.products(1)).products[0].price, 10, 'within the window: cached')
  t += 25000
  assert.equal((await cache.products(1)).products[0].price, 20, 'after the window: reloaded')
  state.names[1] = 'منتجات الألبان'
  state.version = 3
  t += 31000
  assert.equal((await cache.categories()).categories[0].name, 'منتجات الألبان')
})

test('large categories load page by page and keep earlier pages', async () => {
  const { api } = fakeApi()
  const cache = createCatalogCache(api)
  let page = await cache.products(2)
  assert.equal(page.products.length, 200)
  page = await cache.more(2)
  page = await cache.more(2)
  assert.equal(page.products.length, 450)
  assert.equal(page.more, false)
  assert.equal(new Set(page.products.map((p) => p.barcode)).size, 450, 'no duplicates')
})

test('memory is bounded: least recently used categories are dropped', async () => {
  const { api, state } = fakeApi()
  const cache = createCatalogCache(api, { maxCategories: 2 })
  await cache.products(1)
  await cache.products(2)
  await cache.products(0)
  const n = state.calls.filter((c) => c === 'pos.categoryProducts').length
  await cache.products(1) // dropped: loaded again
  assert.equal(state.calls.filter((c) => c === 'pos.categoryProducts').length, n + 1)
})

test('invalidate forgets everything immediately', async () => {
  const { api, state } = fakeApi()
  const cache = createCatalogCache(api)
  await cache.products(1)
  cache.invalidate()
  const n = state.calls.length
  await cache.products(1)
  assert.ok(state.calls.length > n)
})
