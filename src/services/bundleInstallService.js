const pool = require("../config/database");
const { decide } = require("./bundleSync");

/*
 * Bundle install steps owned by identity-service: a bundle's own namespaced
 * permissions, and its role templates, which become ordinary custom roles of
 * the installing organization.
 *
 * Called by bundle-service with the installing admin's own token. Both steps
 * are idempotent; role templates follow bundleSync's rule, so a role the firm
 * has edited is never overwritten by a reinstall or an upgrade.
 */

// A bundle can never mint an administrator through a role template.
const isForbiddenInTemplate = (code) => code.startsWith("system.") || code === "bundles.manage";

// Platform permission groups a bundle namespace may not take over. Mirrors
// bundle-sdk's RESERVED_NAMESPACES.
const RESERVED_NAMESPACES = new Set([
  "leads", "customers", "services", "users", "organization", "reports", "system",
  "communications", "email", "bundles", "profiles", "engagements", "fees",
  "obligations", "documents", "vault", "files",
]);

function badRequest(message, details) {
  const error = new Error(message);
  error.statusCode = 400;
  if (details) error.details = details;
  return error;
}

function conflict(message) {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
}

function checkNamespace(namespace) {
  if (typeof namespace !== "string" || !/^[a-z]{2,20}$/.test(namespace) || RESERVED_NAMESPACES.has(namespace)) {
    throw badRequest("A valid bundle namespace is required");
  }
}

async function inTransaction(work) {
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
 * Permissions are global (one table for every organization), so a bundle's
 * own codes are shared by every organization that installs it. A code owned
 * by the platform or another bundle is never taken over.
 */
async function installPermissions(bundleKey, { namespace, permissions = [] }) {
  checkNamespace(namespace);

  const invalid = permissions.filter(
    (permission) => typeof permission?.code !== "string" || !permission.code.startsWith(`${namespace}.`) || !permission.name,
  );

  if (invalid.length > 0) {
    throw badRequest(`Bundle permissions must be named and start with "${namespace}."`, invalid.map((p) => p?.code));
  }

  return inTransaction(async (client) => {
    let installed = 0;

    for (const permission of permissions) {
      const result = await client.query(
        `INSERT INTO permissions (code, name, description, bundle_key)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE
           SET name = EXCLUDED.name, description = EXCLUDED.description
           WHERE permissions.bundle_key = EXCLUDED.bundle_key
         RETURNING id`,
        [permission.code, permission.name, permission.description || null, bundleKey],
      );

      if (result.rows.length === 0) {
        throw conflict(`Permission ${permission.code} belongs to the platform or another bundle`);
      }

      installed += 1;
    }

    // The built-in administrator holds every permission, including these.
    await client.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id
       FROM roles r CROSS JOIN permissions p
       WHERE r.code = 'SUPER_ADMIN' AND r.organization_id IS NULL AND p.bundle_key = $1
       ON CONFLICT DO NOTHING`,
      [bundleKey],
    );

    return { installed };
  });
}

async function roleContent(client, role) {
  const permissions = await client.query(
    `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = $1 ORDER BY p.code`,
    [role.id],
  );

  return {
    name: role.name,
    description: role.description || null,
    permissions: permissions.rows.map((row) => row.code),
  };
}

async function setPermissions(client, roleId, codes) {
  await client.query("DELETE FROM role_permissions WHERE role_id = $1", [roleId]);
  await client.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT $1, id FROM permissions WHERE code = ANY($2::text[])
     ON CONFLICT DO NOTHING`,
    [roleId, codes],
  );
}

/*
 * Role templates → custom roles of this organization, matched by template
 * key. Templates the bundle no longer ships are retired, never deleted: users
 * may still hold them.
 */
async function installRoles(organizationId, bundleKey, version, { namespace, roles = [] }) {
  checkNamespace(namespace);

  const forbidden = roles.flatMap((role) => (role.permissions || []).filter(isForbiddenInTemplate).map((code) => `${role.key}: ${code}`));

  if (forbidden.length > 0) {
    throw badRequest("Role templates cannot grant system permissions or bundles.manage", forbidden);
  }

  const wanted = [...new Set(roles.flatMap((role) => role.permissions || []))];
  const known = await pool.query("SELECT code FROM permissions WHERE code = ANY($1::text[])", [wanted]);
  const knownCodes = new Set(known.rows.map((row) => row.code));
  const unknown = wanted.filter((code) => !knownCodes.has(code));

  if (unknown.length > 0) {
    throw badRequest("Role templates name permissions that do not exist", unknown);
  }

  return inTransaction(async (client) => {
    const summary = { inserted: 0, updated: 0, unchanged: 0, kept: 0, retired: 0 };

    for (const template of roles) {
      const templateKey = `${namespace}_${template.key}`;
      const shipped = {
        name: template.name,
        description: template.description || null,
        permissions: [...new Set(template.permissions)].sort(),
      };

      // Matched by template key; failing that, a custom role with the code
      // this template would take is adopted rather than duplicated.
      const found = await client.query(
        `SELECT id, name, description, source_checksum FROM roles
         WHERE organization_id = $1 AND (template_key = $2 OR (template_key IS NULL AND code = $3))
         ORDER BY template_key NULLS LAST
         LIMIT 1`,
        [organizationId, templateKey, templateKey.toUpperCase()],
      );

      const row = found.rows[0];
      const existing = row ? { content: await roleContent(client, row), sourceChecksum: row.source_checksum } : null;
      const { action, shippedChecksum, flag } = decide(existing, shipped);

      if (action === "insert") {
        const created = await client.query(
          `INSERT INTO roles (code, name, description, is_system_role, organization_id,
                              bundle_key, template_key, source_version, source_checksum)
           VALUES ($1, $2, $3, false, $4, $5, $6, $7, $8)
           RETURNING id`,
          [templateKey.toUpperCase(), shipped.name, shipped.description, organizationId, bundleKey, templateKey, version, shippedChecksum],
        );

        await setPermissions(client, created.rows[0].id, shipped.permissions);
        summary.inserted += 1;
        continue;
      }

      if (action === "update") {
        await client.query("UPDATE roles SET name = $1, description = $2 WHERE id = $3", [shipped.name, shipped.description, row.id]);
        await setPermissions(client, row.id, shipped.permissions);
      }

      if (action === "keep") {
        // The firm's edit stands; the shipped checksum stays what it came from.
        await client.query(
          `UPDATE roles
           SET bundle_key = $1, template_key = $2, retired_at = NULL,
               update_available_version = CASE WHEN $3 THEN $4 ELSE update_available_version END
           WHERE id = $5`,
          [bundleKey, templateKey, flag, version, row.id],
        );
        summary.kept += 1;
        continue;
      }

      await client.query(
        `UPDATE roles
         SET bundle_key = $1, template_key = $2, source_version = $3, source_checksum = $4,
             update_available_version = NULL, retired_at = NULL
         WHERE id = $5`,
        [bundleKey, templateKey, version, shippedChecksum, row.id],
      );
      summary[action === "update" ? "updated" : "unchanged"] += 1;
    }

    const retired = await client.query(
      `UPDATE roles SET retired_at = NOW()
       WHERE organization_id = $1 AND bundle_key = $2 AND retired_at IS NULL
         AND template_key <> ALL($3::text[])`,
      [organizationId, bundleKey, roles.map((role) => `${namespace}_${role.key}`)],
    );

    summary.retired = retired.rowCount;

    return summary;
  });
}

module.exports = { installPermissions, installRoles, isForbiddenInTemplate };
