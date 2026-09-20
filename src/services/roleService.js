const pool = require("../config/database");

/*
 * Roles are either built-in (organization_id NULL, shared by every
 * organization and not editable) or custom to one organization.
 *
 * Every read is filtered to "mine or built-in"; every write is restricted to
 * custom roles owned by the caller's organization.
 */

// Stripping this role's permissions would leave nobody able to administer
// anything, so it is protected beyond the is_system_role check.
const PROTECTED_ROLE_CODE = "SUPER_ADMIN";

function conflict(message) {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
}

function notFound(message = "Role not found") {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

async function listRoles(organizationId) {
  const result = await pool.query(
    `
    SELECT
      r.id,
      r.code,
      r.name,
      r.description,
      r.is_system_role,
      r.organization_id,
      COUNT(DISTINCT rp.permission_id)::int AS permission_count,
      COUNT(DISTINCT ou.user_id)::int AS user_count
    FROM roles r
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    LEFT JOIN organization_users ou
      ON ou.role_id = r.id AND ou.organization_id = $1
    WHERE r.organization_id IS NULL OR r.organization_id = $1
    GROUP BY r.id
    ORDER BY r.organization_id NULLS FIRST, r.name
    `,
    [organizationId],
  );

  return result.rows;
}

async function getRoleById(organizationId, roleId) {
  const result = await pool.query(
    `
    SELECT id, code, name, description, is_system_role, organization_id
    FROM roles
    WHERE id = $1 AND (organization_id IS NULL OR organization_id = $2)
    `,
    [roleId, organizationId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const permissions = await pool.query(
    `
    SELECT p.id, p.code, p.name, p.description
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = $1
    ORDER BY p.code
    `,
    [roleId],
  );

  return { ...result.rows[0], permissions: permissions.rows };
}

// Custom roles owned by this organization only. Built-ins are shared, so
// letting one tenant edit them would change every other tenant's access.
async function getEditableRole(organizationId, roleId) {
  const result = await pool.query(
    "SELECT id, code, is_system_role, organization_id FROM roles WHERE id = $1",
    [roleId],
  );

  const role = result.rows[0];

  if (!role || (role.organization_id !== null && role.organization_id !== organizationId)) {
    throw notFound();
  }

  if (role.is_system_role || role.organization_id === null) {
    throw conflict("Built-in roles cannot be modified");
  }

  return role;
}

async function createRole(organizationId, input) {
  const name = input.name?.trim();
  const code = input.code?.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");

  if (!name) {
    const error = new Error("Role name is required");
    error.statusCode = 400;
    throw error;
  }

  if (!code) {
    const error = new Error("Role code is required");
    error.statusCode = 400;
    throw error;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const role = await client.query(
      `INSERT INTO roles (code, name, description, is_system_role, organization_id)
       VALUES ($1, $2, $3, false, $4)
       RETURNING id, code, name, description, is_system_role, organization_id`,
      [code, name, input.description?.trim() || null, organizationId],
    );

    await setPermissions(client, role.rows[0].id, input.permissionCodes);

    await client.query("COMMIT");

    return role.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateRole(organizationId, roleId, input) {
  await getEditableRole(organizationId, roleId);

  const result = await pool.query(
    `UPDATE roles SET name = COALESCE($1, name), description = $2
     WHERE id = $3
     RETURNING id, code, name, description, is_system_role, organization_id`,
    [input.name?.trim() || null, input.description?.trim() || null, roleId],
  );

  return result.rows[0];
}

async function setPermissions(client, roleId, permissionCodes) {
  await client.query("DELETE FROM role_permissions WHERE role_id = $1", [roleId]);

  if (!Array.isArray(permissionCodes) || permissionCodes.length === 0) {
    return;
  }

  await client.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT $1, p.id FROM permissions p WHERE p.code = ANY($2::text[])
     ON CONFLICT DO NOTHING`,
    [roleId, permissionCodes],
  );
}

async function setRolePermissions(organizationId, roleId, permissionCodes) {
  await getEditableRole(organizationId, roleId);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await setPermissions(client, roleId, permissionCodes);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return getRoleById(organizationId, roleId);
}

async function deleteRole(organizationId, roleId) {
  const role = await getEditableRole(organizationId, roleId);

  if (role.code === PROTECTED_ROLE_CODE) {
    throw conflict("This role cannot be deleted");
  }

  const assigned = await pool.query(
    "SELECT COUNT(*)::int AS count FROM organization_users WHERE role_id = $1",
    [roleId],
  );

  if (assigned.rows[0].count > 0) {
    throw conflict(
      `This role is assigned to ${assigned.rows[0].count} user(s). Reassign them before deleting it.`,
    );
  }

  const result = await pool.query(
    "DELETE FROM roles WHERE id = $1 RETURNING id",
    [roleId],
  );

  return result.rows[0];
}

module.exports = {
  listRoles,
  getRoleById,
  createRole,
  updateRole,
  setRolePermissions,
  deleteRole,
};
