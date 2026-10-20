/**
 * List products.
 * @swagger
 * @route GET /products
 * @group products - Product operations
 * @param {Array.<string>} ids.query - Product IDs
 * @param {string} search.query - Search text
 * @param {enum} status.query - Status - eg: active,archived
 * @param {Array.<string>} labels.header - Labels
 * @returns {Array.<Product>} 200 - Products
 * @headers {integer} 200.X-Rate-Limit - Remaining calls
 * @operationId listProducts
 * @summary List products
 * @produces application/json
 * @security JWT
 */

/**
 * This route is deliberately not marked as Swagger documentation.
 * @route GET /internal
 * @returns {string} 200 - Internal response
 */
