const pool = require("../config/database");

// A grant is deliberately short-lived. Anything longer belongs in a role.
const MAX_DURATION_MINUTES = 24 * 60;

const GRANT_COLUMNS = `
  g.id,
  g.organization_id,
  g.user_id,
  g.subject_email,
  g.permission_code,
  g.reason,
  g.granted_by,
  g.expires_at,
  g.revoked_at,
  g.created_at
`;

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

async function listGrants(organizationId) {
  const result = await pool.query(
    `
    SELECT ${GRANT_COLUMNS},
      u.name AS user_name,
      u.email AS user_email,
      gb.name AS granted_by_name,
      p.name AS permission_name,
      (g.revoked_at IS NULL AND g.expires_at > NOW()) AS is_active
    FROM access_grants g
    LEFT JOIN users u ON u.id = g.user_id
    LEFT JOIN users gb ON gb.id = g.granted_by
    LEFT JOIN permissions p ON p.code = g.permission_code
    WHERE g.organization_id = $1
    ORDER BY (g.revoked_at IS NULL AND g.expires_at > NOW()) DESC, g.created_at DESC
    LIMIT 200
    `,
    [organizationId],
  );

  return result.rows;
}

/*
 * One row per permission rather than one row holding a list: each granted
 * permission can then be revoked on its own, and the middleware lookup stays a
 * flat "which codes are active for this user" query.
 */
async function createGrant(organizationId, grantedBy, input) {
  const requested = Array.isArray(input.permission_codes)
    ? input.permission_codes
    : [input.permission_code];

  const permissionCodes = [
    ...new Set(
      requested
        .filter((code) => typeof code === "string")
        .map((code) => code.trim())
        .filter(Boolean),
    ),
  ];

  const reason = input.reason?.trim();
  const minutes = Number(input.duration_minutes);

  if (permissionCodes.length === 0) {
    throw badRequest("At least one permission is required");
  }

  // A grant without a stated reason is not auditable, which defeats the point.
  if (!reason) {
    throw badRequest("A reason is required");
  }

  if (!Number.isInteger(minutes) || minutes < 5 || minutes > MAX_DURATION_MINUTES) {
    throw badRequest(`duration_minutes must be between 5 and ${MAX_DURATION_MINUTES}`);
  }

  const userId = input.user_id ? Number(input.user_id) : null;
  const subjectEmail = input.subject_email?.trim().toLowerCase() || null;

  if (!userId && !subjectEmail) {
    throw badRequest("Either user_id or subject_email is required");
  }

  // The target must belong to the caller's organization, or a grant could be
  // written against someone else's user.
  if (userId) {
    const member = await pool.query(
      "SELECT 1 FROM organization_users WHERE user_id = $1 AND organization_id = $2",
      [userId, organizationId],
    );

    if (member.rows.length === 0) {
      const error = new Error("User not found in this organization");
      error.statusCode = 404;
      throw error;
    }
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const created = [];

    for (const permissionCode of permissionCodes) {
      const result = await client.query(
        `INSERT INTO access_grants
           (organization_id, user_id, subject_email, permission_code, reason,
            granted_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW() + make_interval(mins => $7))
         RETURNING id`,
        [organizationId, userId, subjectEmail, permissionCode, reason, grantedBy, minutes],
      );

      created.push(result.rows[0].id);
    }

    // All or nothing: a partial grant would be confusing to reason about and
    // half-revoke later.
    await client.query("COMMIT");

    return Promise.all(created.map((id) => getGrantById(organizationId, id)));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getGrantById(organizationId, grantId) {
  const result = await pool.query(
    `SELECT ${GRANT_COLUMNS},
       u.name AS user_name,
       u.email AS user_email,
       (g.revoked_at IS NULL AND g.expires_at > NOW()) AS is_active
     FROM access_grants g
     LEFT JOIN users u ON u.id = g.user_id
     WHERE g.id = $1 AND g.organization_id = $2`,
    [grantId, organizationId],
  );

  return result.rows[0] || null;
}

/*
 * Revoking stamps revoked_at rather than deleting the row: the record of who
 * had what access, and who withdrew it, is the audit trail.
 */
async function revokeGrant(organizationId, grantId, revokedBy) {
  const result = await pool.query(
    `UPDATE access_grants
     SET revoked_at = NOW(), revoked_by = $1
     WHERE id = $2 AND organization_id = $3 AND revoked_at IS NULL
     RETURNING id`,
    [revokedBy, grantId, organizationId],
  );

  if (result.rows.length === 0) {
    const error = new Error("Grant not found or already revoked");
    error.statusCode = 404;
    throw error;
  }

  return getGrantById(organizationId, grantId);
}

module.exports = {
  MAX_DURATION_MINUTES,
  listGrants,
  createGrant,
  getGrantById,
  revokeGrant,
};
