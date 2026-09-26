const bcrypt = require("bcryptjs");

const pool = require("../config/database");

/*
 * The signed-in person's own record.
 *
 * Every function takes its user id from the verified token, never from the
 * request, so there is no id to tamper with: this can only ever read or change
 * the caller. That is why the routes need no permission beyond being signed in
 * — editing other people stays on /users, behind users.update.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MIN_PASSWORD_LENGTH = 8;

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function getProfile(auth) {
  const result = await pool.query(
    `SELECT u.id, u.name, u.email, u.status, u.is_guest, u.created_at,
            o.name AS organization_name,
            r.name AS role_name,
            r.code AS role_code
       FROM users u
       JOIN organizations o ON o.id = $2
       LEFT JOIN organization_users ou
              ON ou.user_id = u.id AND ou.organization_id = o.id
       LEFT JOIN roles r ON r.id = ou.role_id
      WHERE u.id = $1`,
    [auth.userId, auth.organizationId],
  );

  if (!result.rows[0]) {
    throw httpError(404, "Profile not found");
  }

  return result.rows[0];
}

/*
 * Guests are materialised from an invite: no password, and an identity that is
 * their invited email address. Letting them rename themselves or change that
 * address would muddy who the grant was actually given to.
 */
async function loadEditable(client, userId) {
  const result = await client.query(
    `SELECT id, email, password_hash, is_guest FROM users WHERE id = $1 FOR UPDATE`,
    [userId],
  );

  const user = result.rows[0];

  if (!user) {
    throw httpError(404, "Profile not found");
  }

  if (user.is_guest) {
    throw httpError(403, "Guest profiles cannot be changed");
  }

  return user;
}

/*
 * Checks the current password. A wrong one is a 400, not a 401: the frontend
 * treats 401 as an expired session and signs the person out, which is the
 * wrong response to a typo.
 */
async function requirePassword(user, currentPassword) {
  const valid =
    typeof currentPassword === "string" &&
    currentPassword.length > 0 &&
    user.password_hash &&
    (await bcrypt.compare(currentPassword, user.password_hash));

  if (!valid) {
    throw httpError(400, "Your current password is incorrect");
  }
}

async function withTransaction(work) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await work(client);

    await client.query("COMMIT");

    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/*
 * Name, and optionally email. Changing the email changes what the person signs
 * in with, so it needs their current password — a session left open on a
 * shared machine must not be enough to take the account over.
 */
async function updateProfile(auth, { name, email, currentPassword }) {
  const nextName = typeof name === "string" ? name.trim() : undefined;
  const nextEmail = typeof email === "string" ? email.trim().toLowerCase() : undefined;

  if (nextName !== undefined && (nextName.length === 0 || nextName.length > 150)) {
    throw httpError(400, "Name must be between 1 and 150 characters");
  }

  if (nextEmail !== undefined && (!EMAIL_PATTERN.test(nextEmail) || nextEmail.length > 255)) {
    throw httpError(400, "Enter a valid email address");
  }

  await withTransaction(async (client) => {
    const user = await loadEditable(client, auth.userId);

    const emailChanging = nextEmail !== undefined && nextEmail !== user.email.toLowerCase();

    if (emailChanging) {
      await requirePassword(user, currentPassword);
    }

    try {
      await client.query(
        `UPDATE users
            SET name = COALESCE($2, name),
                email = COALESCE($3, email),
                updated_at = NOW()
          WHERE id = $1`,
        [auth.userId, nextName ?? null, emailChanging ? nextEmail : null],
      );
    } catch (error) {
      if (error.code === "23505") {
        throw httpError(409, "That email address is already in use");
      }

      throw error;
    }
  });

  return getProfile(auth);
}

async function changePassword(auth, { currentPassword, newPassword }) {
  if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw httpError(400, `The new password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  if (newPassword.length > 200) {
    throw httpError(400, "The new password is too long");
  }

  await withTransaction(async (client) => {
    const user = await loadEditable(client, auth.userId);

    await requirePassword(user, currentPassword);

    if (await bcrypt.compare(newPassword, user.password_hash)) {
      throw httpError(400, "The new password must be different from the current one");
    }

    // Same cost as account creation in userService.
    const passwordHash = await bcrypt.hash(newPassword, 12);

    await client.query(
      `UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1`,
      [auth.userId, passwordHash],
    );
  });
}

module.exports = { getProfile, updateProfile, changePassword };
