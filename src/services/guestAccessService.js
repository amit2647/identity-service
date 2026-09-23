const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const pool = require("./../config/database");

const GUEST_ROLE = "GUEST";

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/*
 * 32 random bytes, base64url. The link is the guest's only credential, so it
 * has to be unguessable and is stored only as a hash — a database leak must not
 * hand over working access.
 */
function issueInviteToken() {
  const token = crypto.randomBytes(32).toString("base64url");

  return { token, hash: hashToken(token) };
}

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

/*
 * Turns the invite into a session.
 *
 * The guest is materialised as a users row the first time they redeem, and every
 * grant issued to their email is attached to it. From that point the normal
 * per-request grant lookup applies to them, so revoking or expiring a grant cuts
 * them off immediately — which a self-contained token could not do.
 */
async function redeemInvite(token) {
  if (!token || typeof token !== "string") {
    throw notFound("This link is not valid");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const grantResult = await client.query(
      `SELECT id, organization_id, subject_email, user_id, expires_at
       FROM access_grants
       WHERE invite_token_hash = $1
         AND revoked_at IS NULL
         AND expires_at > NOW()
       LIMIT 1`,
      [hashToken(token)],
    );

    if (grantResult.rows.length === 0) {
      // One message for every failure mode: an expired, revoked and never-valid
      // link should be indistinguishable to whoever is holding it.
      throw notFound("This link is no longer valid");
    }

    const grant = grantResult.rows[0];
    const email = grant.subject_email;

    let userId = grant.user_id;

    if (!userId) {
      const existing = await client.query(
        "SELECT id FROM users WHERE LOWER(email) = LOWER($1)",
        [email],
      );

      if (existing.rows.length > 0) {
        userId = existing.rows[0].id;
      } else {
        const created = await client.query(
          `INSERT INTO users (name, email, password_hash, is_guest)
           VALUES ($1, $2, NULL, true)
           RETURNING id`,
          [email.split("@")[0], email],
        );

        userId = created.rows[0].id;
      }
    }

    // Attach every outstanding grant for this email, not just the one redeemed:
    // a second grant issued before they first clicked should apply too.
    await client.query(
      `UPDATE access_grants
       SET user_id = $1,
           redeemed_at = COALESCE(redeemed_at, NOW())
       WHERE subject_email = $2 AND user_id IS NULL`,
      [userId, email],
    );

    await client.query("COMMIT");

    /*
     * The token carries no permissions and no role. Everything the guest can do
     * comes from the live grant lookup, so revocation leaves them with nothing.
     * It also expires with the grant rather than on the usual 8 hour schedule.
     */
    const secondsLeft = Math.max(
      60,
      Math.floor((new Date(grant.expires_at).getTime() - Date.now()) / 1000),
    );

    const accessToken = jwt.sign(
      {
        sub: String(userId),
        username: email,
        organizationId: grant.organization_id,
        role: GUEST_ROLE,
        permissions: [],
        guest: true,
      },
      process.env.JWT_SECRET,
      {
        issuer: process.env.JWT_ISSUER || "omnicore-identity-service",
        expiresIn: secondsLeft,
      },
    );

    return {
      token: accessToken,
      email,
      expiresAt: grant.expires_at,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  GUEST_ROLE,
  issueInviteToken,
  hashToken,
  redeemInvite,
};
