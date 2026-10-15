// In-memory catalogue for category browsing at the till (1.4.0).
//
// What it keeps: the active categories and, per category, the pages of products already shown.
// Switching between categories already opened needs no database query. Freshness: before serving
// from memory, the catalogue version (one tiny query, pos.catalogVersion) is checked at most every
// `maxAgeMs`; any change of names, prices, units, categories or active status clears everything.
// Correctness never depends on this cache: a browsed product is added through pos.resolve and sold
// through pos.checkout, which use the current prices and refuse stopped products.
//
// Memory: at most `maxCategories` categories' product pages are kept (least recently used dropped),
// each page ≤ 200 small rows.

export function createCatalogCache(
  api,
  { maxAgeMs = 30000, maxCategories = 40, now = Date.now } = {}
) {
  let version = null
  let checkedAt = 0
  let categories = null
  const pages = new Map() // categoryId → { products, more }
  const stats = { queries: 0, hits: 0 }

  const clear = () => {
    categories = null
    pages.clear()
  }

  async function fresh() {
    if (version !== null && now() - checkedAt < maxAgeMs) return
    stats.queries += 1
    const r = await api('pos.catalogVersion')
    checkedAt = now()
    if (version !== null && r.version !== version) clear()
    version = r.version
  }

  function remember(id, entry) {
    pages.delete(id)
    pages.set(id, entry)
    while (pages.size > maxCategories) pages.delete(pages.keys().next().value)
  }

  return {
    stats,
    /** { categories: [{ id, name, products }], uncategorised } */
    async categories() {
      await fresh()
      if (categories) {
        stats.hits += 1
        return categories
      }
      stats.queries += 1
      const r = await api('pos.categories')
      version = r.version
      categories = { categories: r.categories, uncategorised: r.uncategorised }
      return categories
    },
    /** First page (cached) of a category: { products, more } */
    async products(categoryId) {
      await fresh()
      const hit = pages.get(categoryId)
      if (hit) {
        stats.hits += 1
        remember(categoryId, hit)
        return hit
      }
      stats.queries += 1
      const r = await api('pos.categoryProducts', { categoryId })
      const entry = { products: r.products, more: r.more }
      remember(categoryId, entry)
      return entry
    },
    /** Next page of a category, appended to what is cached. */
    async more(categoryId) {
      const cur = pages.get(categoryId)
      if (!cur || !cur.more) return cur
      stats.queries += 1
      const r = await api('pos.categoryProducts', { categoryId, offset: cur.products.length })
      const entry = { products: [...cur.products, ...r.products], more: r.more }
      remember(categoryId, entry)
      return entry
    },
    /** Forget everything (e.g. after the till learns a product was changed or stopped). */
    invalidate() {
      clear()
      checkedAt = 0
    }
  }
}
