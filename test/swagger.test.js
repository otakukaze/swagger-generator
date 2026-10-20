const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const parser = require("@apidevtools/swagger-parser");
const { generateSpec, parseApiFile, fileFormat } = require("..");

const fixtures = path.join(__dirname, "fixtures");

// The generator mutates swaggerDefinition, so never share options across tests.
function options(overrides = {}) {
  return {
    swaggerDefinition: {
      info: { title: "Product API", version: "1.0.0" },
      host: "localhost:3000",
      basePath: "/v1",
      schemes: ["https"],
      securityDefinitions: {
        JWT: { type: "apiKey", name: "Authorization", in: "header" },
      },
    },
    basedir: fixtures,
    files: ["./**/*.{js,ts}"],
    ...overrides,
  };
}

test("generates and validates Swagger from recursive brace globs", async () => {
  const spec = await generateSpec(options());
  assert.equal(spec.swagger, "2.0");
  assert.deepEqual(spec.info, { title: "Product API", version: "1.0.0" });
  assert.equal(spec.host, "localhost:3000");
  assert.equal(spec.basePath, "/v1");
  assert.deepEqual(spec.schemes, ["https"]);
  assert.deepEqual(Object.keys(spec.paths), ["/products"]);
  assert.deepEqual(Object.keys(spec.paths["/products"]).sort(), ["get", "post"]);
  // parse() alone does not validate the schema. Validate a copy because this
  // also dereferences models and would change subsequent reference assertions.
  await parser.validate(structuredClone(spec));
});

test("merges methods from separate file patterns without duplicating tags", async () => {
  const spec = await generateSpec(options({
    files: ["./models.js", "./routes/products.js", "./routes/nested/*.js"],
  }));
  assert.equal(spec.paths["/products"].get.operationId, "listProducts");
  assert.equal(spec.paths["/products"].post.responses["201"].description, "Created product");
  assert.deepEqual(spec.tags, [{ name: "products", description: "Product operations" }]);
});

test("parses model requirements, typed examples and arrays", async () => {
  const { definitions } = await generateSpec(options());
  const product = definitions.Product;
  assert.deepEqual(product.required, ["id", "name"]);
  assert.equal(product.properties.id.type, "integer");
  assert.equal(product.properties.id.example, 42);
  assert.equal(product.properties.active.example, true);
  assert.deepEqual(product.properties.labels.items, { type: "string" });
  assert.deepEqual(product.properties.categories.items, { $ref: "#/definitions/Category" });
  assert.deepEqual(definitions.Category.required, ["name"]);
});

test("preserves model references in request bodies and responses", async () => {
  const { paths } = await generateSpec(options());
  const post = paths["/products"].post;
  assert.deepEqual(post.parameters, [{
    name: "product",
    in: "body",
    description: "Product to create",
    required: true,
    schema: { $ref: "#/definitions/Product" },
  }]);
  assert.deepEqual(post.responses["201"].schema, { $ref: "#/definitions/Product" });
  assert.deepEqual(paths["/products"].get.responses["200"].schema, {
    type: "array", items: { $ref: "#/definitions/Product" },
  });
});

test("parses query enums and response headers", async () => {
  const spec = await generateSpec(options());
  const get = spec.paths["/products"].get;
  const status = get.parameters.find((param) => param.name === "status");
  assert.equal(status.in, "query");
  assert.equal(status.required, false);
  assert.equal(status.type, "string");
  assert.deepEqual(status.enum, ["active", "archived"]);
  assert.deepEqual(get.responses["200"].headers, {
    "X-Rate-Limit": { type: "integer", description: "Remaining calls" },
  });
});

test("parses operation metadata and both security annotation forms", async () => {
  const spec = await generateSpec(options());
  const { get, post } = spec.paths["/products"];
  assert.equal(get.summary, "List products");
  assert.equal(get.description, "List products.");
  assert.deepEqual(get.produces, ["application/json"]);
  assert.deepEqual(post.consumes, ["application/json"]);
  assert.equal(post.deprecated, true);
  assert.deepEqual(get.security, [{ JWT: [] }]);
  assert.deepEqual(post.security, [{ JWT: [] }]);
});

test("applies supported collection formats only to query arrays", async () => {
  for (const format of ["csv", "tsv", "ssv", "pipes", "multi"]) {
    const spec = await generateSpec(options({ parametersArrayStyle: format }));
    const params = spec.paths["/products"].get.parameters;
    assert.equal(params.find((p) => p.name === "ids").collectionFormat, format);
    assert.equal(params.find((p) => p.name === "search").collectionFormat, undefined);
    assert.equal(params.find((p) => p.name === "labels").collectionFormat, undefined);
  }
});

test("leaves collection format unset by default", async () => {
  const spec = await generateSpec(options());
  assert.equal(spec.paths["/products"].get.parameters[0].collectionFormat, undefined);
});

test("rejects unsupported collection formats", async () => {
  await assert.rejects(
    generateSpec(options({ parametersArrayStyle: "invalid" })),
    /Invalid collection format: invalid/,
  );
});

test("rejects missing required options", async () => {
  await assert.rejects(generateSpec(), /'options' is required/);
  await assert.rejects(generateSpec({}), /'swaggerDefinition' is required/);
  await assert.rejects(generateSpec({ swaggerDefinition: {} }), /'files' is required/);
});

test("returns empty paths when files are empty or no files match", async () => {
  for (const files of [[], ["./missing/**/*.js"]]) {
    const spec = await generateSpec(options({ files }));
    assert.deepEqual(spec.paths, {});
    assert.deepEqual(spec.definitions, {});
    assert.deepEqual(spec.tags, []);
  }
});

test("parses JSDoc files and ignores comments without the swagger tag", () => {
  const comments = parseApiFile(path.join(fixtures, "routes/products.js"));
  const documented = comments.find((c) => c.tags.some((t) => t.title === "swagger"));
  const internal = comments.find((c) => c.tags.some((t) => t.description === "GET /internal"));
  assert.ok(documented);
  assert.ok(internal);
  assert.equal(fileFormat(documented).parameters["/products"].get.operationId, "listProducts");
  assert.deepEqual(fileFormat(internal), { parameters: {}, tags: [], definitions: {} });
});

test("reports missing files from parseApiFile", () => {
  assert.throws(() => parseApiFile(path.join(fixtures, "missing.js")), { code: "ENOENT" });
});

test("skips malformed annotations while retaining valid routes", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swagger-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "malformed.js"), `
/**
 * @swagger
 * @route
 */
/**
 * @swagger
 * @route GET /healthy
 * @returns {string} 200 - Healthy
 */
`);
  const log = t.mock.method(console, "log", () => {});
  const spec = await generateSpec(options({ basedir: dir, files: ["*.js"] }));
  assert.deepEqual(Object.keys(spec.paths), ["/healthy"]);
  assert.equal(spec.paths["/healthy"].get.responses["200"].description, "Healthy");
  assert.equal(log.mock.callCount(), 1);
  assert.match(log.mock.calls[0].arguments[0], /Incorrect comment format/);
});
