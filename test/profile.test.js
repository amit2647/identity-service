const { describe, test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");

/*
 * Self-service profile rules, with the database replaced by an in-memory
 * user. The one that matters most: every write targets the caller from the
 * token, whatever else is sent.
 */

const pool = require("../src/config/database");

const CURRENT_PASSWORD = "Current-123!";

let user;
let updates;
let uniqueViolation;

function fakeClient() {
  return {
    async query(text, params) {
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(text)) {
        return {};
      }

      if (/FROM users WHERE id = \$1 FOR UPDATE/.test(text)) {
        return { rows: params[0] === user.id ? [user] : [] };
      }

      if (/^\s*UPDATE users/.test(text)) {
        if (uniqueViolation) {
          const error = new Error("duplicate key");
          error.code = "23505";
          throw error;
        }

        updates.push({ text, params });
        return { rowCount: 1 };
      }

      throw new Error(`unexpected query: ${text}`);
    },
    release() {},
  };
}

pool.connect = async () => fakeClient();
pool.query = async () => ({
  rows: [{ id: user.id, name: "Admin", email: user.email, is_guest: user.is_guest }],
});

const { updateProfile, changePassword } = require("../src/services/profileService");

const auth = { userId: 1, organizationId: 1 };

async function rejectsWith(promise, statusCode) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.statusCode, statusCode, error.message);
    return true;
  });
}

beforeEach(async () => {
  user = {
    id: 1,
    email: "admin@acme.example",
    password_hash: await bcrypt.hash(CURRENT_PASSWORD, 4),
    is_guest: false,
  };
  updates = [];
  uniqueViolation = false;
});

describe("updateProfile", () => {
  test("renames the caller, identified by the token", async () => {
    await updateProfile(auth, { name: "  New Name  " });

    assert.equal(updates.length, 1);
    assert.equal(updates[0].params[0], auth.userId);
    assert.equal(updates[0].params[1], "New Name");
  });

  test("refuses an empty or overlong name", async () => {
    await rejectsWith(updateProfile(auth, { name: "   " }), 400);
    await rejectsWith(updateProfile(auth, { name: "x".repeat(151) }), 400);
    assert.equal(updates.length, 0);
  });

  test("refuses a malformed email", async () => {
    await rejectsWith(
      updateProfile(auth, { email: "not-an-email", currentPassword: CURRENT_PASSWORD }),
      400,
    );
  });

  test("an email change needs the current password", async () => {
    await rejectsWith(updateProfile(auth, { email: "new@acme.example" }), 400);
    await rejectsWith(
      updateProfile(auth, { email: "new@acme.example", currentPassword: "wrong" }),
      400,
    );
    assert.equal(updates.length, 0);
  });

  test("a wrong password is 400, never 401 (401 signs the client out)", async () => {
    await rejectsWith(
      updateProfile(auth, { email: "new@acme.example", currentPassword: "wrong" }),
      400,
    );
  });

  test("stores the new email lowercased", async () => {
    await updateProfile(auth, { email: "New@Acme.Example", currentPassword: CURRENT_PASSWORD });

    assert.equal(updates[0].params[2], "new@acme.example");
  });

  test("an unchanged email needs no password", async () => {
    await updateProfile(auth, { name: "Admin", email: "ADMIN@acme.example" });

    assert.equal(updates.length, 1);
    assert.equal(updates[0].params[2], null);
  });

  test("an address already in use is 409", async () => {
    uniqueViolation = true;

    await rejectsWith(
      updateProfile(auth, { email: "taken@acme.example", currentPassword: CURRENT_PASSWORD }),
      409,
    );
  });

  test("guests cannot change their profile", async () => {
    user.is_guest = true;

    await rejectsWith(updateProfile(auth, { name: "Someone" }), 403);
  });
});

describe("changePassword", () => {
  test("refuses a short password", async () => {
    await rejectsWith(
      changePassword(auth, { currentPassword: CURRENT_PASSWORD, newPassword: "short" }),
      400,
    );
  });

  test("refuses a wrong current password", async () => {
    await rejectsWith(changePassword(auth, { currentPassword: "wrong", newPassword: "Another-123!" }), 400);
  });

  test("refuses reusing the current password", async () => {
    await rejectsWith(
      changePassword(auth, { currentPassword: CURRENT_PASSWORD, newPassword: CURRENT_PASSWORD }),
      400,
    );
  });

  test("stores a bcrypt hash of the new password, for the caller only", async () => {
    await changePassword(auth, { currentPassword: CURRENT_PASSWORD, newPassword: "Another-123!" });

    assert.equal(updates.length, 1);
    assert.equal(updates[0].params[0], auth.userId);
    assert.ok(await bcrypt.compare("Another-123!", updates[0].params[1]));
  });

  test("guests have no password to change", async () => {
    user.is_guest = true;

    await rejectsWith(
      changePassword(auth, { currentPassword: CURRENT_PASSWORD, newPassword: "Another-123!" }),
      403,
    );
  });
});
