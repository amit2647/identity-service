const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const pool = require("../config/database");

async function login(email, password) {
  /*
   * =========================================================
   * FIND USER
   * =========================================================
   */

  const userResult = await pool.query(
    `
    SELECT
      id,
      name,
      email,
      password_hash,
      status
    FROM users
    WHERE LOWER(email) = LOWER($1)
    LIMIT 1
    `,
    [email.trim()],
  );

  if (userResult.rows.length === 0) {
    const error = new Error("Invalid email or password");
    error.statusCode = 401;
    throw error;
  }

  const user = userResult.rows[0];

  /*
   * =========================================================
   * USER STATUS
   * =========================================================
   */

  if (user.status !== "Active") {
    const error = new Error("User account is inactive");
    error.statusCode = 403;
    throw error;
  }

  /*
   * =========================================================
   * VERIFY PASSWORD
   * =========================================================
   */

  const passwordValid = await bcrypt.compare(password, user.password_hash);

  if (!passwordValid) {
    const error = new Error("Invalid email or password");
    error.statusCode = 401;
    throw error;
  }

  /*
   * =========================================================
   * GET ORGANIZATION MEMBERSHIPS
   * =========================================================
   */

  const membershipsResult = await pool.query(
    `
    SELECT
      o.id AS organization_id,
      o.name AS organization_name,
      o.slug AS organization_slug,
      o.status AS organization_status,

      r.id AS role_id,
      r.code AS role_code,
      r.name AS role_name

    FROM organization_users ou

    INNER JOIN organizations o
      ON o.id = ou.organization_id

    INNER JOIN roles r
      ON r.id = ou.role_id

    WHERE
      ou.user_id = $1
      AND o.status = 'Active'

    ORDER BY o.name
    `,
    [user.id],
  );

  if (membershipsResult.rows.length === 0) {
    const error = new Error("User does not belong to an active organization");

    error.statusCode = 403;

    throw error;
  }

  /*
   * =========================================================
   * CURRENT ORGANIZATION
   * =========================================================
   *
   * For the first version, use the first organization.
   *
   * Multi-organization switching will be added later.
   */

  const membership = membershipsResult.rows[0];

  /*
   * =========================================================
   * GET ROLE PERMISSIONS
   * =========================================================
   */

  const permissionsResult = await pool.query(
    `
    SELECT
      p.code
    FROM role_permissions rp

    INNER JOIN permissions p
      ON p.id = rp.permission_id

    WHERE rp.role_id = $1

    ORDER BY p.code
    `,
    [membership.role_id],
  );

  const permissions = permissionsResult.rows.map(
    (permission) => permission.code,
  );

  /*
   * =========================================================
   * JWT
   * =========================================================
   */

  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }

  const token = jwt.sign(
    {
      sub: user.id,

      organizationId: membership.organization_id,

      role: membership.role_code,

      permissions,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "8h",
      issuer: "omnicore-identity-service",
    },
  );

  /*
   * =========================================================
   * RESPONSE
   * =========================================================
   */

  return {
    token,

    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
    },

    organization: {
      id: membership.organization_id,
      name: membership.organization_name,
      slug: membership.organization_slug,
    },

    role: {
      id: membership.role_id,
      code: membership.role_code,
      name: membership.role_name,
    },

    permissions,
  };
}

module.exports = {
  login,
};
