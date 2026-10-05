const { describe, test, beforeEach, before, after, mock } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

/*
 * identity-service's bundle install steps: namespaced permissions and role
 * templates. The database is an in-memory stand-in; what matters is which
 * statements run and what is refused before any do.
 */

process.env.JWT_SECRET = "unit-test-secret";
process.env.JWT_ISSUER = "unit-test-issuer";

const { checksum } = require("../src/services/bundleSync");
const pool = require("../src/config/database");

let statements;
let existingRole;
let existingCodes;
let knownCodes;
let permissionOwnedElsewhere;

function fakeClient() {
  return {
    async query(text, params = []) {
      statements.push({ text: text.replace(/\s+/g, " ").trim(), params });

      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(text)) return {};
      if (/INSERT INTO permissions/.test(text)) return { rows: permissionOwnedElsewhere ? [] : [{ id: 1 }] };
      if (/FROM roles\s+WHERE organization_id = \$1 AND \(template_key/.test(text)) return { rows: existingRole ? [existingRole] : [] };
      if (/SELECT p\.code FROM role_permissions/.test(text)) return { rows: existingCodes.map((code) => ({ code })) };
      if (/INSERT INTO roles/.test(text)) return { rows: [{ id: 99 }] };
      if (/UPDATE roles SET retired_at/.test(text)) return { rowCount: 0 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
}

pool.connect = async () => fakeClient();
pool.query = async (text, params) => {
  if (/access_grants/.test(text)) return { rows: [] };
  if (/SELECT code FROM permissions WHERE code = ANY/.test(text)) {
    return { rows: params[0].filter((code) => knownCodes.has(code)).map((code) => ({ code })) };
  }
  return { rows: [] };
};

const { installPermissions, installRoles } = require("../src/services/bundleInstallService");

const PARTNER = { key: "partner", name: "Partner", permissions: ["customers.read", "profiles.read", "ca.udin.manage"] };

beforeEach(() => {
  statements = [];
  existingRole = null;
  existingCodes = [];
  knownCodes = new Set(["customers.read", "profiles.read", "ca.udin.manage", "system.settings", "bundles.manage"]);
  permissionOwnedElsewhere = false;
});

async function rejectsWith(promise, statusCode, pattern) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.statusCode, statusCode, error.message);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

const ran = (pattern) => statements.some((statement) => pattern.test(statement.text));

describe("role templates", () => {
  test("may never grant system.* or bundles.manage — refused before anything is written", async () => {
    for (const code of ["system.settings", "bundles.manage"]) {
      await rejectsWith(
        installRoles(1, "ca-practice", "0.1.0", { namespace: "ca", roles: [{ ...PARTNER, permissions: [code] }] }),
        400,
        /cannot grant/,
      );
    }

    assert.equal(statements.length, 0);
  });

  test("may only name permissions that exist", async () => {
    await rejectsWith(
      installRoles(1, "ca-practice", "0.1.0", { namespace: "ca", roles: [{ ...PARTNER, permissions: ["files.share"] }] }),
      400,
      /do not exist/,
    );
  });

  test("a new template becomes a custom role of the organization", async () => {
    const summary = await installRoles(7, "ca-practice", "0.1.0", { namespace: "ca", roles: [PARTNER] });

    assert.equal(summary.inserted, 1);

    const insert = statements.find((statement) => /INSERT INTO roles/.test(statement.text));

    assert.deepEqual(insert.params.slice(0, 7), ["CA_PARTNER", "Partner", null, 7, "ca-practice", "ca_partner", "0.1.0"]);
    assert.ok(ran(/INSERT INTO role_permissions/));
  });

  test("a role the firm edited is kept, not overwritten", async () => {
    const shippedV1 = { name: "Partner", description: null, permissions: ["customers.read"] };

    existingRole = { id: 5, name: "Senior Partner", description: null, source_checksum: checksum(shippedV1) };
    existingCodes = ["customers.read"];

    const summary = await installRoles(7, "ca-practice", "0.2.0", { namespace: "ca", roles: [PARTNER] });

    assert.equal(summary.kept, 1);
    assert.equal(ran(/UPDATE roles SET name/), false);
    assert.equal(ran(/DELETE FROM role_permissions/), false);

    const flag = statements.find((statement) => /update_available_version = CASE/.test(statement.text));

    assert.equal(flag.params[2], true);
    assert.equal(flag.params[3], "0.2.0");
  });

  test("an untouched role takes the new version", async () => {
    const shippedV1 = { name: "Partner", description: null, permissions: ["customers.read"] };

    existingRole = { id: 5, name: "Partner", description: null, source_checksum: checksum(shippedV1) };
    existingCodes = ["customers.read"];

    const summary = await installRoles(7, "ca-practice", "0.2.0", { namespace: "ca", roles: [PARTNER] });

    assert.equal(summary.updated, 1);
    assert.ok(ran(/UPDATE roles SET name/));
  });

  test("templates the bundle dropped are retired, not deleted", async () => {
    await installRoles(7, "ca-practice", "0.1.0", { namespace: "ca", roles: [PARTNER] });

    const retire = statements.find((statement) => /UPDATE roles SET retired_at/.test(statement.text));

    assert.deepEqual(retire.params, [7, "ca-practice", ["ca_partner"]]);
    assert.equal(ran(/DELETE FROM roles/), false);
  });
});

describe("bundle permissions", () => {
  test("must start with the bundle's namespace", async () => {
    await rejectsWith(installPermissions("ca-practice", { namespace: "ca", permissions: [{ code: "leads.export", name: "x" }] }), 400);
  });

  test("a namespace may not shadow a platform group", async () => {
    await rejectsWith(installPermissions("vault-bundle", { namespace: "vault", permissions: [] }), 400);
  });

  test("a code owned by the platform or another bundle is never taken over", async () => {
    permissionOwnedElsewhere = true;

    await rejectsWith(
      installPermissions("ca-practice", { namespace: "ca", permissions: [{ code: "ca.udin.manage", name: "UDIN" }] }),
      409,
    );
  });

  test("are granted to the built-in administrator", async () => {
    await installPermissions("ca-practice", { namespace: "ca", permissions: [{ code: "ca.udin.manage", name: "UDIN" }] });

    assert.ok(ran(/r\.code = 'SUPER_ADMIN' AND r\.organization_id IS NULL AND p\.bundle_key = \$1/));
  });
});

describe("routes", () => {
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

  const put = (path, permissions) =>
    fetch(`${base}${path}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt.sign({ sub: 1, organizationId: 1, role: "X", permissions }, process.env.JWT_SECRET, { issuer: process.env.JWT_ISSUER })}`,
      },
      body: JSON.stringify({ namespace: "ca", roles: [] }),
    });

  test("need bundles.manage — system.settings alone is not enough", async () => {
    assert.equal((await put("/roles/bundles/ca-practice/0.1.0", ["system.settings"])).status, 403);
    assert.equal((await put("/permissions/bundles/ca-practice/0.1.0", ["users.read"])).status, 403);
  });

  test("refuse a malformed bundle key or version", async () => {
    assert.equal((await put("/roles/bundles/CA/latest", ["bundles.manage"])).status, 400);
  });

  test("leave the existing role routes alone", async () => {
    assert.equal((await put("/roles/12", ["users.read"])).status, 403);
  });
});
