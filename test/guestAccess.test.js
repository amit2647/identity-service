const { test } = require("node:test");
const assert = require("node:assert/strict");

const { issueInviteToken, hashToken } = require("../src/services/guestAccessService");

/*
 * The invite link is a guest's only credential: it must be unguessable, and
 * only its hash may be stored, so a database leak hands over no working link.
 */

test("tokens are long, URL-safe and unique", () => {
  const tokens = new Set();

  for (let i = 0; i < 200; i += 1) {
    const { token } = issueInviteToken();

    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    tokens.add(token);
  }

  assert.equal(tokens.size, 200);
});

test("the stored hash is not the token, and matches it", () => {
  const { token, hash } = issueInviteToken();

  assert.notEqual(hash, token);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hashToken(token), hash);
});
