const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const pool = require("../config/database");
const authService = require("./authService");

/*
 * First-run setup: a new installation configured without an admin is set up
 * from the browser. The migrate container's seed prepares a placeholder
 * organization and prints a one-time setup code to its log (only the hash is
 * stored, in install_setup); POST /setup checks the code, names the
 * organization, creates the first admin (SUPER_ADMIN) and closes setup.
 *
 * The code proves the person setting up can see the server's logs, so a
 * freshly started server exposed to a network cannot be claimed by whoever
 * reaches it first. Setup is refused for good once it has completed, or
 * whenever an administrator already exists.
 *
 * Setup also installs the deployment's profession bundle (SETUP_BUNDLE,
 * default ca-practice; empty for the plain CRM), through bundle-service's own
 * install, as the new admin — on the server, so closing the browser cannot
 * skip it. A failed install never undoes setup: Settings → Profession Bundle
 * resumes it.
 */

const BUNDLE_SERVICE_URL = process.env.BUNDLE_SERVICE_URL || "http://bundle-service:4008";
const INSTALL_TIMEOUT_MS = 2 * 60 * 1000;

// The bundle setup installs; read per call so tests can set it.
const setupBundle = () => (process.env.SETUP_BUNDLE === undefined ? "ca-practice" : process.env.SETUP_BUNDLE.trim());

const CODE_HOURS = 24;
const MAX_FAILED_ATTEMPTS = 10;
const MIN_PASSWORD = 12;
const BCRYPT_COST = 12;

function httpError(statusCode, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}

// Must match migrations/seed.js: case, dashes and spaces do not matter.
function codeHash(code) {
  return crypto.createHash("sha256").update(String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "")).digest("hex");
}

function sameHash(a, b) {
  const left = Buffer.from(String(a || ""), "hex");
  const right = Buffer.from(String(b || ""), "hex");
  return left.length === 32 && right.length === 32 && crypto.timingSafeEqual(left, right);
}

function slugOf(name) {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return slug || "organization";
}

// Any zone the runtime knows, aliases included (Asia/Kolkata is listed as
// Asia/Calcutta in Intl.supportedValuesOf, but both are valid).
function isTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}

// Field-level problems with what the installer entered, or {}.
function validate({ organization = {}, admin = {} }) {
  const problems = {};
  const name = String(organization.name || "").trim();
  const email = String(admin.email || "").trim();
  const password = String(admin.password || "");

  if (name.length < 2 || name.length > 150) problems["organization.name"] = "Enter the organization's name (2–150 characters)";
  if (organization.timeZone && !isTimeZone(organization.timeZone)) problems["organization.timeZone"] = "Choose a time zone from the list";
  if (organization.currency && !/^[A-Z]{3}$/.test(organization.currency)) problems["organization.currency"] = "Use a three-letter currency code, e.g. INR";
  if (String(admin.name || "").trim().length < 2) problems["admin.name"] = "Enter the administrator's name";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems["admin.email"] = "Enter a valid email address";
  if (password.length < MIN_PASSWORD) problems["admin.password"] = `Use at least ${MIN_PASSWORD} characters`;
  else if (password.toLowerCase() === email.toLowerCase()) problems["admin.password"] = "The password cannot be the email address";

  return problems;
}

async function adminExists(db) {
  const result = await db.query(
    `SELECT 1 FROM organization_users ou JOIN roles r ON r.id = ou.role_id
     WHERE r.code = 'SUPER_ADMIN' LIMIT 1`,
  );
  return result.rowCount > 0;
}

// The public summary of the bundle setup will install, or null for none.
async function bundleSummary() {
  const key = setupBundle();
  if (!key) return null;

  try {
    const response = await fetch(`${BUNDLE_SERVICE_URL}/bundles/offered/${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(5000) });
    if (response.ok) return (await response.json()).bundle;
  } catch {
    // Shown by key alone; the install itself reports any real problem.
  }

  return { key, name: key, unavailable: true };
}

// Installs the setup bundle as the new admin (signed in exactly as a person would be).
async function installSetupBundle(email, password) {
  const key = setupBundle();
  if (!key) return null;

  try {
    const { token } = await authService.login(email, password);
    const response = await fetch(`${BUNDLE_SERVICE_URL}/bundles/${encodeURIComponent(key)}/install`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(INSTALL_TIMEOUT_MS),
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) return { key, status: "failed", error: body.error || `HTTP ${response.status}` };
    return { key, status: body.bundle?.status || "installed", version: body.bundle?.version };
  } catch (error) {
    return { key, status: "failed", error: error.message };
  }
}

// Whether this installation still needs setting up, and the name to suggest.
async function status() {
  const setup = (await pool.query("SELECT completed_at, code_hash FROM install_setup WHERE id")).rows[0];
  const required = Boolean(setup && !setup.completed_at && setup.code_hash) && !(await adminExists(pool));

  if (!required) return { required: false };

  const organization = (await pool.query("SELECT name, time_zone, currency FROM organizations ORDER BY id LIMIT 1")).rows[0];
  return {
    required: true,
    organization: organization ? { name: organization.name, timeZone: organization.time_zone, currency: organization.currency } : null,
    bundle: await bundleSummary(),
  };
}

async function complete(input = {}) {
  const problems = validate(input);
  if (Object.keys(problems).length > 0) throw httpError(400, "Some details need attention", problems);

  const client = await pool.connect();
  let failed = false;
  let result;

  try {
    await client.query("BEGIN");

    const setup = (await client.query("SELECT * FROM install_setup WHERE id FOR UPDATE")).rows[0];

    if (!setup || setup.completed_at || (await adminExists(client))) {
      throw httpError(409, "This installation is already set up. Sign in instead.");
    }

    if (!setup.code_hash || !setup.code_created_at || Date.now() - new Date(setup.code_created_at).getTime() > CODE_HOURS * 3600 * 1000) {
      throw httpError(403, "The setup code has expired. Run `docker compose up migrate` on the server for a new one.");
    }

    if (setup.failed_attempts >= MAX_FAILED_ATTEMPTS) {
      throw httpError(429, "Too many wrong setup codes. Run `docker compose up migrate` on the server for a new one.");
    }

    if (!sameHash(codeHash(input.code), setup.code_hash)) {
      failed = true;
      throw httpError(403, "That setup code is not right. It is printed in the migrate container's log.", { code: "That setup code is not right" });
    }

    const { organization, admin } = input;
    const organizationRow = (await client.query("SELECT id FROM organizations ORDER BY id LIMIT 1 FOR UPDATE")).rows[0];
    const name = organization.name.trim();
    const email = admin.email.trim().toLowerCase();

    let organizationId;
    if (organizationRow) {
      organizationId = organizationRow.id;
      await client.query(
        `UPDATE organizations SET name = $1, slug = $2, time_zone = COALESCE($3, time_zone), currency = COALESCE($4, currency), updated_at = NOW()
         WHERE id = $5`,
        [name, slugOf(name), organization.timeZone || null, organization.currency || null, organizationId],
      );
    } else {
      organizationId = (
        await client.query(
          "INSERT INTO organizations (name, slug, time_zone, currency) VALUES ($1, $2, COALESCE($3, 'Asia/Kolkata'), COALESCE($4, 'INR')) RETURNING id",
          [name, slugOf(name), organization.timeZone || null, organization.currency || null],
        )
      ).rows[0].id;
    }

    const taken = await client.query("SELECT 1 FROM users WHERE LOWER(email) = $1", [email]);
    if (taken.rowCount > 0) throw httpError(409, "An account with this email already exists", { "admin.email": "Already in use" });

    const userId = (
      await client.query("INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id", [
        admin.name.trim(),
        email,
        await bcrypt.hash(admin.password, BCRYPT_COST),
      ])
    ).rows[0].id;

    await client.query(
      `INSERT INTO organization_users (organization_id, user_id, role_id)
       SELECT $1, $2, r.id FROM roles r WHERE r.code = 'SUPER_ADMIN'`,
      [organizationId, userId],
    );

    await client.query(
      "UPDATE install_setup SET completed_at = NOW(), completed_by = $1, code_hash = NULL, updated_at = NOW() WHERE id",
      [userId],
    );

    await client.query(
      `INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'install.setup_completed', 'organization', $3, $4)`,
      [organizationId, userId, String(organizationId), { organization: name, admin: email }],
    );

    await client.query("COMMIT");
    result = { organization: { id: organizationId, name }, admin: { email } };
  } catch (error) {
    await client.query("ROLLBACK");

    // Counted outside the rolled-back transaction, so a guess always costs one.
    if (failed) {
      await pool.query("UPDATE install_setup SET failed_attempts = failed_attempts + 1, updated_at = NOW() WHERE id");
    }

    if (error.code === "23505") throw httpError(409, "That organization name or email is already in use");
    throw error;
  } finally {
    client.release();
  }

  // After the commit: the admin exists, setup is closed, whatever happens here.
  result.bundle = await installSetupBundle(result.admin.email, input.admin.password);
  return result;
}

module.exports = { status, complete, validate, codeHash, slugOf, MAX_FAILED_ATTEMPTS };
