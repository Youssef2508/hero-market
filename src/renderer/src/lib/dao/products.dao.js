import { executeQuery } from '../db'
import { escapeSql } from '../utils'

/**
 * Get product count and low stock warnings count.
 */
export async function getProductsStats() {
  const totalRes = await executeQuery('SELECT count(*) as count FROM products;')
  const lowStockRes = await executeQuery(
    'SELECT count(*) as count FROM products WHERE stock_qty <= reorder_limit AND reorder_limit > 0;'
  )
  return {
    totalItems: totalRes[0]?.count || 0,
    lowStock: lowStockRes[0]?.count || 0
  }
}

/**
 * Find product by exact barcode match or fallback suffix match.
 *
 * @param {string} barcode
 * @returns {Promise<object|null>}
 */
export async function findProductByBarcode(barcode) {
  const cleanBarcode = escapeSql(barcode.trim())

  // Try exact match first
  let res = await executeQuery(`SELECT * FROM products WHERE barcode = '${cleanBarcode}' LIMIT 1;`)

  // Fallback: Suffix match if no exact match found
  if ((!res || res.length === 0) && cleanBarcode.length >= 6) {
    res = await executeQuery(
      `SELECT * FROM products WHERE barcode LIKE '%${cleanBarcode}' LIMIT 2;`
    )
  }

  return res && res.length > 0 ? res[0] : null
}

/**
 * Get paginated products list for admin panel.
 *
 * @param {object} params
 * @param {string} params.search
 * @param {number} params.page
 * @param {number} params.itemsPerPage
 */
export async function getAdminProducts({ search = '', page = 1, itemsPerPage = 12 }) {
  const offset = (page - 1) * itemsPerPage
  const cleanSearch = escapeSql(search.trim())

  let countSql = `SELECT count(*) as count FROM products;`
  let selectSql = `SELECT * FROM products ORDER BY name ASC LIMIT ${itemsPerPage} OFFSET ${offset};`

  if (cleanSearch) {
    countSql = `SELECT count(*) as count FROM products WHERE name LIKE '%${cleanSearch}%' OR barcode LIKE '%${cleanSearch}%';`
    selectSql = `SELECT * FROM products WHERE name LIKE '%${cleanSearch}%' OR barcode LIKE '%${cleanSearch}%' ORDER BY name ASC LIMIT ${itemsPerPage} OFFSET ${offset};`
  }

  const countRes = await executeQuery(countSql)
  const products = await executeQuery(selectSql)

  return {
    products,
    totalCount: countRes[0]?.count || 0
  }
}

/**
 * Add a new product to database.
 *
 * @param {object} product
 */
export async function addProduct({
  barcode,
  name,
  cost_price,
  retail_price,
  wholesale_price,
  stock_qty,
  reorder_limit,
  unit
}) {
  await executeQuery(`
    INSERT INTO products (barcode, name, cost_price, retail_price, wholesale_price, stock_qty, reorder_limit, unit)
    VALUES (
      '${escapeSql(barcode)}', 
      '${escapeSql(name)}', 
      ${parseFloat(cost_price) || 0}, 
      ${parseFloat(retail_price) || 0}, 
      ${parseFloat(wholesale_price) || 0}, 
      ${parseFloat(stock_qty) || 0}, 
      ${parseFloat(reorder_limit) || 0}, 
      '${escapeSql(unit) || ''}'
    );
  `)
}

/**
 * Update an existing product.
 *
 * @param {object} product
 */
export async function updateProduct({
  barcode,
  name,
  cost_price,
  retail_price,
  wholesale_price,
  stock_qty,
  reorder_limit,
  unit
}) {
  await executeQuery(`
    UPDATE products 
    SET name = '${escapeSql(name)}', 
        cost_price = ${parseFloat(cost_price) || 0}, 
        retail_price = ${parseFloat(retail_price) || 0}, 
        wholesale_price = ${parseFloat(wholesale_price) || 0}, 
        stock_qty = ${parseFloat(stock_qty) || 0}, 
        reorder_limit = ${parseFloat(reorder_limit) || 0}, 
        unit = '${escapeSql(unit) || ''}'
    WHERE barcode = '${escapeSql(barcode)}';
  `)
}

/**
 * Delete a product.
 *
 * @param {string} barcode
 */
export async function deleteProduct(barcode) {
  await executeQuery(`DELETE FROM products WHERE barcode = '${escapeSql(barcode)}';`)
}
