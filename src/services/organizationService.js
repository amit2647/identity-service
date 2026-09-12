const pool = require("../config/database");

async function getAllOrganizations() {
  const result = await pool.query(`
    SELECT
      o.id,
      o.name,
      o.slug,
      o.status,
      o.created_at,
      o.updated_at,
      COUNT(ou.user_id)::int AS user_count
    FROM organizations o
    LEFT JOIN organization_users ou
      ON ou.organization_id = o.id
    GROUP BY o.id
    ORDER BY o.id DESC
  `);

  return result.rows;
}

async function getOrganizationById(organizationId) {
  const result = await pool.query(
    `
    SELECT
      o.id,
      o.name,
      o.slug,
      o.status,
      o.created_at,
      o.updated_at,
      COUNT(ou.user_id)::int AS user_count
    FROM organizations o
    LEFT JOIN organization_users ou
      ON ou.organization_id = o.id
    WHERE o.id = $1
    GROUP BY o.id
    `,
    [organizationId],
  );

  return result.rows[0] || null;
}

async function createOrganization(data) {
  const result = await pool.query(
    `
    INSERT INTO organizations
    (
      name,
      slug,
      status
    )
    VALUES
    ($1, $2, $3)
    RETURNING *
    `,
    [data.name.trim(), data.slug.trim().toLowerCase(), data.status || "Active"],
  );

  return result.rows[0];
}

async function updateOrganization(organizationId, data) {
  const result = await pool.query(
    `
    UPDATE organizations
    SET
      name = COALESCE($1, name),
      slug = COALESCE($2, slug),
      status = COALESCE($3, status),
      updated_at = NOW()
    WHERE id = $4
    RETURNING *
    `,
    [
      data.name?.trim() || null,
      data.slug?.trim().toLowerCase() || null,
      data.status || null,
      organizationId,
    ],
  );

  return result.rows[0] || null;
}

async function getOrganizationUsers(organizationId) {
  const result = await pool.query(
    `
    SELECT
      u.id,
      u.name,
      u.email,
      u.status,
      u.created_at,
      u.updated_at,

      r.id AS role_id,
      r.code AS role_code,
      r.name AS role_name

    FROM organization_users ou

    INNER JOIN users u
      ON u.id = ou.user_id

    INNER JOIN roles r
      ON r.id = ou.role_id

    WHERE ou.organization_id = $1

    ORDER BY u.id DESC
    `,
    [organizationId],
  );

  return result.rows;
}

async function organizationExists(organizationId) {
  const result = await pool.query(
    `
    SELECT id
    FROM organizations
    WHERE id = $1
    `,
    [organizationId],
  );

  return result.rows.length > 0;
}

module.exports = {
  getAllOrganizations,
  getOrganizationById,
  createOrganization,
  updateOrganization,
  getOrganizationUsers,
  organizationExists,
};
