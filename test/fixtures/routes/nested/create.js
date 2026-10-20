/**
 * Create a product.
 * @swagger
 * @route POST /products
 * @group products - Product operations
 * @param {Product.model} product.body.required - Product to create
 * @returns {Product.model} 201 - Created product
 * @consumes application/json
 * @produces application/json
 * @security [{"JWT":[]}]
 * @deprecated
 */
