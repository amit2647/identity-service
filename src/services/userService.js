const bcrypt = require("bcryptjs");

const pool = require("../config/database");

async function getUserById(userId) {
  const result = await pool.query(
    `
    SELECT
      u.id,
      u.name,
      u.email,
      u.status,
      u.created_at,
      u.updated_at
    FROM users u
    WHERE u.id = $1
    `,
    [userId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const user = result.rows[0];

  const membershipsResult = await pool.query(
    `
    SELECT
      o.id AS organization_id,
      o.name AS organization_name,
      o.slug AS organization_slug,

      r.id AS role_id,
      r.code AS role_code,
      r.name AS role_name

    FROM organization_users ou

    INNER JOIN organizations o
      ON o.id = ou.organization_id

    INNER JOIN roles r
      ON r.id = ou.role_id

    WHERE ou.user_id = $1

    ORDER BY o.name
    `,
    [userId],
  );

  return {
    ...user,
    organizations: membershipsResult.rows,
  };
}

async function createUser(data) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /*
     * Verify organization.
     */

    const organizationResult = await client.query(
      `
      SELECT id
      FROM organizations
      WHERE id = $1
      `,
      [data.organizationId],
    );

    if (organizationResult.rows.length === 0) {
      const error = new Error("Organization not found");
      error.statusCode = 404;
      throw error;
    }

    /*
     * Verify role.
     */

    const roleResult = await client.query(
      `
      SELECT id, code, name
      FROM roles
      WHERE code = $1
      `,
      [data.roleCode],
    );

    if (roleResult.rows.length === 0) {
      const error = new Error("Role not found");
      error.statusCode = 400;
      throw error;
    }

    /*
     * Hash password.
     */

    const passwordHash = await bcrypt.hash(data.password, 12);

    /*
     * Create user.
     */

    const userResult = await client.query(
      `
      INSERT INTO users
      (
        name,
        email,
        password_hash,
        status
      )
      VALUES
      ($1, $2, $3, $4)
      RETURNING
        id,
        name,
        email,
        status,
        created_at,
        updated_at
      `,
      [
        data.name.trim(),
        data.email.trim().toLowerCase(),
        passwordHash,
        data.status || "Active",
      ],
    );

    const user = userResult.rows[0];

    /*
     * Add organization membership.
     */

    await client.query(
      `
      INSERT INTO organization_users
      (
        organization_id,
        user_id,
        role_id
      )
      VALUES
      ($1, $2, $3)
      `,
      [data.organizationId, user.id, roleResult.rows[0].id],
    );

    await client.query("COMMIT");

    return {
      ...user,

      organization: {
        id: Number(data.organizationId),
      },

      role: {
        id: roleResult.rows[0].id,
        code: roleResult.rows[0].code,
        name: roleResult.rows[0].name,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateUser(userId, data) {
  const result = await pool.query(
    `
    UPDATE users
    SET
      name = COALESCE($1, name),
      email = COALESCE($2, email),
      status = COALESCE($3, status),
      updated_at = NOW()
    WHERE id = $4
    RETURNING
      id,
      name,
      email,
      status,
      created_at,
      updated_at
    `,
    [
      data.name?.trim() || null,
      data.email?.trim().toLowerCase() || null,
      data.status || null,
      userId,
    ],
  );

  return result.rows[0] || null;
}

async function deleteUser(userId) {
  const result = await pool.query(
    `
    DELETE FROM users
    WHERE id = $1
    RETURNING id
    `,
    [userId],
  );

  return result.rows[0] || null;
}

async function getRoles() {
  const result = await pool.query(`
    SELECT
      id,
      code,
      name,
      description,
      is_system_role
    FROM roles
    ORDER BY id
  `);

  return result.rows;
}

async function getPermissions() {
  const result = await pool.query(`
    SELECT
      id,
      code,
      name,
      description
    FROM permissions
    ORDER BY id
  `);

  return result.rows;
}

/*
 * Membership check that scopes the user-management endpoints.
 *
 * Those handlers take the target id straight from the URL, so without this a
 * manager in one organization could read, edit or delete users belonging to
 * another. Permission alone is not enough: every manager role holds users.read.
 */
async function isUserInOrganization(userId, organizationId) {
  const result = await pool.query(
    `
    SELECT 1
    FROM organization_users
    WHERE user_id = $1
      AND organization_id = $2
    `,
    [userId, organizationId],
  );

  return result.rows.length > 0;
}

module.exports = {
  getUserById,
  isUserInOrganization,
  createUser,
  updateUser,
  deleteUser,
  getRoles,
  getPermissions,
};
