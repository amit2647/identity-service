const { test, before, after, beforeEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

/*
 * The firm profile and its signing professionals (SET-01–03): bundle fields
 * validated against the bundle, one default signatory, and nothing at all
 * for an organization without a bundle.
 */

process.env.JWT_SECRET = "unit-test-secret";
process.env.JWT_ISSUER = "unit-test-issuer";
process.env.BUNDLE_SERVICE_URL = "http://bundle-service.test";

const BUNDLE = {
  key: "ca-practice",
  profiles: {
    organization: { version: 1, schema: { type: "object", properties: { frn: { type: "string", title: "FRN", pattern: "^[0-9]{6}[A-Z]$" } } } },
    professional: { version: 1, schema: { type: "object", properties: { membership_no: { type: "string", title: "ICAI membership number", pattern: "^[0-9]{6}$" } } } },
  },
};

let installed;
let statements;

const realFetch = global.fetch;

global.fetch = async (url, options) =>
  String(url).startsWith("http://bundle-service.test")
    ? new Response(JSON.stringify({ bundle: installed }), { status: 200 })
    : realFetch(url, options);

function query(text, params = []) {
  const sql = text.replace(/\s+/g, " ").trim();
  statements.push({ sql, params });
  if (/access_grants/.test(sql)) return { rows: [] };
  if (/^SELECT o\.id, o\.name/.test(sql)) return { rows: [{ id: 3, name: "Rao & Co", time_zone: "Asia/Kolkata", currency: "INR", attributes: {} }] };
  if (/^(INSERT INTO professionals|UPDATE professionals SET name)/.test(sql)) return { rows: [{ id: 1, name: params[0] }] };
  return { rows: [], rowCount: 1 };
}

const pool = require("../src/config/database");

pool.query = async (text, params) => query(text, params);
pool.connect = async () => ({ query: async (text, params) => query(text, params), release() {} });

const firm = require("../src/services/firmService");
const { forget } = require("../src/services/bundleContext");

beforeEach(() => {
  installed = BUNDLE;
  statements = [];
  forget(3);
});

after(() => {
  global.fetch = realFetch;
});

const caller = { organizationId: 3, userId: 1 };

test("the firm's FRN is checked against the bundle's field (SET-01)", async () => {
  await assert.rejects(firm.updateFirm(caller, BUNDLE, { attributes: { frn: "12345" } }), (error) => error.statusCode === 400 && /FRN must match/.test(error.details.frn));

  await firm.updateFirm(caller, BUNDLE, { legalName: "Rao & Co LLP", attributes: { frn: "123456W" } });

  const upsert = statements.find((s) => /^INSERT INTO organization_profiles/.test(s.sql));

  assert.deepEqual([upsert.params[1], upsert.params[6], upsert.params[7]], ["Rao & Co LLP", { frn: "123456W" }, 1]);
});

test("time zone and currency must be real", async () => {
  await assert.rejects(firm.updateFirm(caller, BUNDLE, { timeZone: "Mars/Olympus" }), (error) => Boolean(error.details?.timeZone));
  await assert.rejects(firm.updateFirm(caller, BUNDLE, { currency: "rupees" }), (error) => Boolean(error.details?.currency));
  assert.equal(firm.validTimeZone("Asia/Kolkata"), true);
});

test("choosing a default signatory clears the previous one (SET-02)", async () => {
  await firm.saveProfessional(caller, BUNDLE, null, { name: "CA A. Rao", attributes: { membership_no: "123456" }, isDefaultSignatory: true });

  const order = statements.map((s) => s.sql.split(" ").slice(0, 2).join(" "));

  assert.ok(order.indexOf("UPDATE professionals") < order.indexOf("INSERT INTO"));
});

test("a signing partner's membership number is checked", async () => {
  await assert.rejects(firm.saveProfessional(caller, BUNDLE, null, { name: "X", attributes: { membership_no: "12" } }), (error) => Boolean(error.details?.membership_no));
  await assert.rejects(firm.saveProfessional(caller, BUNDLE, null, { name: " " }), (error) => Boolean(error.details?.name));
});

const app = require("../src/app");
let server;
let base;

before(async () => {
  mock.method(console, "error", () => {});
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const call = (method, path, permissions) =>
  realFetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt.sign({ sub: 1, organizationId: 3, role: "X", permissions }, process.env.JWT_SECRET, { issuer: process.env.JWT_ISSUER })}` },
  });

test("the firm routes answer only an organization with a bundle", async () => {
  installed = null;
  assert.equal((await call("GET", "/organizations/current/profile", ["organization.read"])).status, 404);

  installed = BUNDLE;
  forget(3);
  const response = await call("GET", "/organizations/current/profile", ["organization.read"]);

  assert.equal(response.status, 200);
  assert.equal((await response.json()).timeZone, "Asia/Kolkata");
});

test("changing the firm needs organization.update", async () => {
  assert.equal((await call("PUT", "/organizations/current/profile", ["organization.read"])).status, 403);
});
