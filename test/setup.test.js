const { describe, test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = "unit-test-secret";
process.env.JWT_ISSUER = "unit-test-issuer";

const pool = require("../src/config/database");
const authService = require("../src/services/authService");
const setupService = require("../src/services/setupService");

/*
 * First-run setup against a fake database: the one-time code, the
 * validation, and that setup closes for good.
 */

const CODE = "K7QF-2M9D-XP4T-8HWN";

let state;
let statements;

function query(text, params = []) {
  const sql = text.replace(/\s+/g, " ").trim();
  statements.push({ sql, params });

  if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return {};
  if (/FROM install_setup/.test(sql)) return { rows: state.setup ? [state.setup] : [] };
  if (/JOIN roles r ON r.id = ou.role_id/.test(sql)) return { rowCount: state.adminExists ? 1 : 0, rows: [] };
  if (/^SELECT id FROM organizations/.test(sql)) return { rows: [{ id: 1 }] };
  if (/^SELECT name, time_zone, currency FROM organizations/.test(sql)) return { rows: [{ name: "My organization", time_zone: "Asia/Kolkata", currency: "INR" }] };
  if (/^SELECT 1 FROM users/.test(sql)) return { rowCount: state.emailTaken ? 1 : 0, rows: [] };
  if (/^INSERT INTO users/.test(sql)) return { rows: [{ id: 42 }] };
  if (/^UPDATE install_setup SET failed_attempts/.test(sql)) {
    state.setup.failed_attempts += 1;
    return { rowCount: 1 };
  }
  return { rows: [], rowCount: 1 };
}

pool.connect = async () => ({ query: async (text, params) => query(text, params), release() {} });
pool.query = async (text, params) => query(text, params);

const INPUT = {
  code: CODE.toLowerCase(),
  organization: { name: "Mehta & Associates", timeZone: "Asia/Kolkata", currency: "INR" },
  admin: { name: "R. Mehta", email: "Owner@Mehta.example", password: "a-long-passphrase" },
};

let calls;
let installReply;

// bundle-service, faked: the offered summary and the install.
global.fetch = async (url, options = {}) => {
  calls.push({ url, options });
  if (/\/bundles\/offered\//.test(url)) return { ok: true, json: async () => ({ bundle: { key: "ca-practice", name: "CA Practice", version: "0.7.2" } }) };
  return installReply();
};

authService.login = async (email) => ({ token: `token-for-${email}` });

beforeEach(() => {
  statements = [];
  calls = [];
  delete process.env.SETUP_BUNDLE;
  installReply = async () => ({ ok: true, json: async () => ({ bundle: { status: "installed", version: "0.7.2" } }) });
  state = {
    setup: { completed_at: null, code_hash: setupService.codeHash(CODE), code_created_at: new Date(), failed_attempts: 0 },
    adminExists: false,
    emailTaken: false,
  };
});

const ran = (pattern) => statements.filter((statement) => pattern.test(statement.sql));

describe("status", () => {
  test("required while a code is waiting and no admin exists, with the name to suggest", async () => {
    assert.deepEqual(await setupService.status(), {
      required: true,
      organization: { name: "My organization", timeZone: "Asia/Kolkata", currency: "INR" },
      bundle: { key: "ca-practice", name: "CA Practice", version: "0.7.2" },
    });
  });

  test("not required once completed, or once any admin exists", async () => {
    state.setup.completed_at = new Date();
    assert.deepEqual(await setupService.status(), { required: false });

    state.setup.completed_at = null;
    state.adminExists = true;
    assert.deepEqual(await setupService.status(), { required: false });
  });
});

describe("complete", () => {
  test("names the organization, creates the admin as SUPER_ADMIN and closes setup, in one transaction", async () => {
    const result = await setupService.complete(INPUT);

    assert.deepEqual(result, {
      organization: { id: 1, name: "Mehta & Associates" },
      admin: { email: "owner@mehta.example" },
      bundle: { key: "ca-practice", status: "installed", version: "0.7.2" },
    });
    assert.deepEqual(ran(/^UPDATE organizations SET name/)[0].params, ["Mehta & Associates", "mehta-associates", "Asia/Kolkata", "INR", 1]);
    assert.equal(ran(/^INSERT INTO users/)[0].params[1], "owner@mehta.example");
    assert.match(ran(/^INSERT INTO users/)[0].params[2], /^\$2[aby]\$12\$/);
    assert.match(ran(/^INSERT INTO organization_users/)[0].sql, /SUPER_ADMIN/);
    assert.equal(ran(/^UPDATE install_setup SET completed_at = NOW\(\)/).length, 1);
    assert.equal(ran(/install\.setup_completed/).length, 1);
    assert.equal(ran(/^COMMIT/).length, 1);
  });

  test("a wrong code is refused and counted, and enough of them lock setup", async () => {
    await assert.rejects(setupService.complete({ ...INPUT, code: "AAAA-BBBB-CCCC-DDDD" }), { statusCode: 403 });
    assert.equal(state.setup.failed_attempts, 1);
    assert.equal(ran(/^INSERT INTO users/).length, 0);

    state.setup.failed_attempts = setupService.MAX_FAILED_ATTEMPTS;
    await assert.rejects(setupService.complete(INPUT), { statusCode: 429 });
  });

  test("an expired code is refused", async () => {
    state.setup.code_created_at = new Date(Date.now() - 25 * 3600 * 1000);
    await assert.rejects(setupService.complete(INPUT), { statusCode: 403, message: /expired/ });
  });

  test("closed for good once completed or once an admin exists", async () => {
    state.setup.completed_at = new Date();
    await assert.rejects(setupService.complete(INPUT), { statusCode: 409 });

    state.setup.completed_at = null;
    state.adminExists = true;
    await assert.rejects(setupService.complete(INPUT), { statusCode: 409 });
    assert.equal(ran(/^INSERT INTO users/).length, 0);
  });

  test("checks what was entered before touching the database", async () => {
    await assert.rejects(
      setupService.complete({ code: CODE, organization: { name: "M", timeZone: "Mars/Olympus", currency: "rupees" }, admin: { name: "", email: "nope", password: "short" } }),
      (error) => {
        assert.equal(error.statusCode, 400);
        assert.deepEqual(Object.keys(error.details).sort(), ["admin.email", "admin.name", "admin.password", "organization.currency", "organization.name", "organization.timeZone"]);
        return true;
      },
    );
    assert.equal(statements.length, 0);
    assert.match(setupService.validate({ organization: { name: "Firm" }, admin: { name: "A B", email: "owner@firm.example", password: "Owner@Firm.example" } })["admin.password"], /cannot be the email/);
  });

  test("the code hash matches the seed's however the code is typed", () => {
    const seedHash = require("crypto").createHash("sha256").update("K7QF2M9DXP4T8HWN").digest("hex");
    assert.equal(setupService.codeHash(" k7qf 2m9d-xp4t-8hwn "), seedHash);
    assert.equal(setupService.slugOf("  Ünïcode & Co.  "), "unicode-co");
  });

  test("installs the setup bundle after the commit, as the new admin", async () => {
    await setupService.complete(INPUT);

    const install = calls.find((call) => /\/install$/.test(call.url));
    assert.match(install.url, /\/bundles\/ca-practice\/install$/);
    assert.equal(install.options.headers.Authorization, "Bearer token-for-owner@mehta.example");
    // The install starts only once setup is committed.
    assert.equal(ran(/^COMMIT/).length, 1);
  });

  test("a failed install never undoes setup", async () => {
    installReply = async () => ({ ok: false, status: 502, json: async () => ({ error: "the catalog service could not be reached" }) });

    const result = await setupService.complete(INPUT);

    assert.deepEqual(result.bundle, { key: "ca-practice", status: "failed", error: "the catalog service could not be reached" });
    assert.equal(ran(/^UPDATE install_setup SET completed_at = NOW\(\)/).length, 1);
    assert.equal(ran(/^ROLLBACK/).length, 0);
  });

  test("with SETUP_BUNDLE empty, setup installs nothing", async () => {
    process.env.SETUP_BUNDLE = "";

    assert.equal((await setupService.status()).bundle, null);
    assert.equal((await setupService.complete(INPUT)).bundle, null);
    assert.equal(calls.length, 0);
  });
});
