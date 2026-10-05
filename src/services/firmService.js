const { profiles } = require("bundle-sdk");

const pool = require("../config/database");

/*
 * The firm behind an organization (SET-01–03) — legal name, address, the
 * bundle's firm fields such as a CA's FRN — and the professionals who sign
 * on its behalf (SET-02), whose details feed every generated document.
 *
 * For organizations with a profession bundle; always the caller's own.
 */

function httpError(statusCode, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}

const text = (value) => (value === undefined || value === null || String(value).trim() === "" ? null : String(value).trim());

function checkAttributes(profile, attributes) {
  if (!profile?.schema) {
    return { attributes: {}, version: null };
  }

  const result = profiles.validate(profile.schema, attributes || {});

  if (!result.valid) {
    throw httpError(400, "Some details need attention", result.errors);
  }

  return { attributes: result.value, version: profile.version };
}

function validTimeZone(zone) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

async function getFirm(organizationId) {
  const result = await pool.query(
    `SELECT o.id, o.name, o.time_zone, o.currency,
            p.legal_name, p.address, p.city, p.email, p.phone, p.attributes, p.updated_at
     FROM organizations o LEFT JOIN organization_profiles p ON p.organization_id = o.id
     WHERE o.id = $1`,
    [organizationId],
  );

  const row = result.rows[0];

  if (!row) throw httpError(404, "Organization not found");

  return {
    id: row.id,
    name: row.name,
    timeZone: row.time_zone,
    currency: row.currency,
    legalName: row.legal_name,
    address: row.address,
    city: row.city,
    email: row.email,
    phone: row.phone,
    attributes: row.attributes || {},
    updatedAt: row.updated_at,
  };
}

async function updateFirm({ organizationId, userId }, bundle, input) {
  const { attributes, version } = checkAttributes(bundle.profiles?.organization, input.attributes);

  if (input.timeZone !== undefined && !validTimeZone(input.timeZone)) {
    throw httpError(400, "Some details need attention", { timeZone: "Not a known time zone" });
  }

  if (input.currency !== undefined && !/^[A-Z]{3}$/.test(input.currency || "")) {
    throw httpError(400, "Some details need attention", { currency: "Use a three-letter currency code, e.g. INR" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `UPDATE organizations
       SET name = COALESCE($1, name), time_zone = COALESCE($2, time_zone), currency = COALESCE($3, currency), updated_at = NOW()
       WHERE id = $4`,
      [text(input.name), input.timeZone || null, input.currency || null, organizationId],
    );

    await client.query(
      `INSERT INTO organization_profiles (organization_id, legal_name, address, city, email, phone, attributes, attributes_version, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (organization_id) DO UPDATE
       SET legal_name = EXCLUDED.legal_name, address = EXCLUDED.address, city = EXCLUDED.city,
           email = EXCLUDED.email, phone = EXCLUDED.phone, attributes = EXCLUDED.attributes,
           attributes_version = EXCLUDED.attributes_version, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [organizationId, text(input.legalName), text(input.address), text(input.city), text(input.email), text(input.phone), attributes, version, userId],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return getFirm(organizationId);
}

const PROFESSIONAL_COLUMNS = "id, user_id, name, designation, attributes, is_default_signatory, status, created_at, updated_at";

async function listProfessionals(organizationId) {
  const result = await pool.query(
    `SELECT ${PROFESSIONAL_COLUMNS} FROM professionals
     WHERE organization_id = $1 AND status = 'Active'
     ORDER BY is_default_signatory DESC, name`,
    [organizationId],
  );

  return result.rows;
}

async function saveProfessional({ organizationId }, bundle, professionalId, input) {
  const name = text(input.name);

  if (!name) throw httpError(400, "Some details need attention", { name: "Name is required" });

  const { attributes, version } = checkAttributes(bundle.profiles?.professional, input.attributes);
  const isDefault = Boolean(input.isDefaultSignatory);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // One default signatory per firm: choosing a new one clears the old.
    if (isDefault) {
      await client.query("UPDATE professionals SET is_default_signatory = false WHERE organization_id = $1", [organizationId]);
    }

    const values = [name, text(input.designation), attributes, version, isDefault];
    const result = professionalId
      ? await client.query(
          `UPDATE professionals SET name = $1, designation = $2, attributes = $3, attributes_version = $4,
                  is_default_signatory = $5, updated_at = NOW()
           WHERE id = $6 AND organization_id = $7 AND status = 'Active'
           RETURNING ${PROFESSIONAL_COLUMNS}`,
          [...values, professionalId, organizationId],
        )
      : await client.query(
          `INSERT INTO professionals (name, designation, attributes, attributes_version, is_default_signatory, organization_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING ${PROFESSIONAL_COLUMNS}`,
          [...values, organizationId],
        );

    if (!result.rows[0]) throw httpError(404, "Professional not found");

    await client.query("COMMIT");

    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Kept, not deleted: documents already signed name them.
async function retireProfessional({ organizationId }, professionalId) {
  const result = await pool.query(
    `UPDATE professionals SET status = 'Inactive', is_default_signatory = false, updated_at = NOW()
     WHERE id = $1 AND organization_id = $2 AND status = 'Active' RETURNING id`,
    [professionalId, organizationId],
  );

  if (!result.rows[0]) throw httpError(404, "Professional not found");
}

module.exports = { getFirm, updateFirm, listProfessionals, saveProfessional, retireProfessional, validTimeZone };
