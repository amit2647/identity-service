const pool = require("../config/database");

async function initializeDatabase() {
  console.log("[DB] Initializing identity database...");

  /*
   * =========================================================
   * ORGANIZATIONS
   * =========================================================
   */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS organizations (
      id SERIAL PRIMARY KEY,

      name VARCHAR(150) NOT NULL,

      slug VARCHAR(150) NOT NULL UNIQUE,

      status VARCHAR(30) NOT NULL DEFAULT 'Active',

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  /*
   * =========================================================
   * USERS
   * =========================================================
   */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,

      name VARCHAR(150) NOT NULL,

      email VARCHAR(255) NOT NULL UNIQUE,

      password_hash TEXT NOT NULL,

      status VARCHAR(30) NOT NULL DEFAULT 'Active',

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  /*
   * =========================================================
   * ROLES
   * =========================================================
   */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id SERIAL PRIMARY KEY,

      code VARCHAR(60) NOT NULL UNIQUE,

      name VARCHAR(150) NOT NULL,

      description TEXT,

      is_system_role BOOLEAN NOT NULL DEFAULT TRUE
    );
  `);

  /*
   * =========================================================
   * PERMISSIONS
   * =========================================================
   */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS permissions (
      id SERIAL PRIMARY KEY,

      code VARCHAR(100) NOT NULL UNIQUE,

      name VARCHAR(150) NOT NULL,

      description TEXT
    );
  `);

  /*
   * =========================================================
   * ROLE ↔ PERMISSION
   * =========================================================
   */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id INTEGER NOT NULL,
      permission_id INTEGER NOT NULL,

      PRIMARY KEY (role_id, permission_id),

      CONSTRAINT fk_role_permissions_role
        FOREIGN KEY (role_id)
        REFERENCES roles(id)
        ON DELETE CASCADE,

      CONSTRAINT fk_role_permissions_permission
        FOREIGN KEY (permission_id)
        REFERENCES permissions(id)
        ON DELETE CASCADE
    );
  `);

  /*
   * =========================================================
   * ORGANIZATION ↔ USER
   * =========================================================
   */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS organization_users (
      organization_id INTEGER NOT NULL,

      user_id INTEGER NOT NULL,

      role_id INTEGER NOT NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      PRIMARY KEY (organization_id, user_id),

      CONSTRAINT fk_organization_users_organization
        FOREIGN KEY (organization_id)
        REFERENCES organizations(id)
        ON DELETE CASCADE,

      CONSTRAINT fk_organization_users_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

      CONSTRAINT fk_organization_users_role
        FOREIGN KEY (role_id)
        REFERENCES roles(id)
        ON DELETE RESTRICT
    );
  `);

  /*
   * =========================================================
   * SEED ROLES
   * =========================================================
   */

  await pool.query(`
    INSERT INTO roles
      (code, name, description)
    VALUES

      (
        'SUPER_ADMIN',
        'Super Admin',
        'Unrestricted access to the entire platform'
      ),

      (
        'OPERATIONS_MANAGER',
        'Operations Manager',
        'Manages data integrity, workflows and reporting'
      ),

      (
        'MARKETING_MANAGER',
        'Marketing Manager',
        'Manages lead generation and marketing activities'
      ),

      (
        'MARKETING_SPECIALIST',
        'Marketing Specialist',
        'Manages lead acquisition activities'
      ),

      (
        'SALES_MANAGER',
        'Sales Manager',
        'Manages sales pipelines, assignments and team performance'
      ),

      (
        'SALES_REP',
        'Sales Representative',
        'Manages assigned leads and customers'
      ),

      (
        'CUSTOMER_SUPPORT_AGENT',
        'Customer Support Agent',
        'Manages customer service activities'
      ),

      (
        'CUSTOMER_SUCCESS_MANAGER',
        'Customer Success Manager',
        'Manages customer relationships and retention'
      )

    ON CONFLICT (code) DO NOTHING;
  `);

  /*
   * =========================================================
   * SEED PERMISSIONS
   * =========================================================
   */

  await pool.query(`
    INSERT INTO permissions
      (code, name, description)
    VALUES

      ('leads.read', 'View Leads', 'View lead records'),
      ('leads.create', 'Create Leads', 'Create new leads'),
      ('leads.update', 'Update Leads', 'Update lead records'),
      ('leads.delete', 'Delete Leads', 'Delete lead records'),
      ('leads.assign', 'Assign Leads', 'Assign leads to users'),

      ('customers.read', 'View Customers', 'View customer records'),
      ('customers.create', 'Create Customers', 'Create customer records'),
      ('customers.update', 'Update Customers', 'Update customer records'),
      ('customers.delete', 'Delete Customers', 'Delete customer records'),
      ('customers.assign', 'Assign Customers', 'Assign customers to users'),

      ('services.read', 'View Services', 'View service catalog'),
      ('services.create', 'Create Services', 'Create services'),
      ('services.update', 'Update Services', 'Update services'),
      ('services.delete', 'Delete Services', 'Delete services'),

      ('users.read', 'View Users', 'View organization users'),
      ('users.create', 'Create Users', 'Create organization users'),
      ('users.update', 'Update Users', 'Update organization users'),
      ('users.delete', 'Delete Users', 'Remove organization users'),

      ('organization.read', 'View Organization', 'View organization information'),
      ('organization.update', 'Update Organization', 'Update organization information'),

      ('reports.read', 'View Reports', 'View operational reports'),
      ('reports.all', 'View All Reports', 'View organization-wide reports'),

      ('system.billing', 'Manage Billing', 'Manage platform billing'),
      ('system.settings', 'System Settings', 'Manage global platform settings'),
      ('system.integrations', 'Manage Integrations', 'Manage third-party integrations'),
      ('system.custom_fields', 'Manage Custom Fields', 'Configure custom fields')

    ON CONFLICT (code) DO NOTHING;
  `);

  /*
   * =========================================================
   * SEED ROLE PERMISSIONS
   * =========================================================
   */

  /*
   * SUPER ADMIN
   *
   * Gets every permission.
   */

  await pool.query(`
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT
      r.id,
      p.id
    FROM roles r
    CROSS JOIN permissions p
    WHERE r.code = 'SUPER_ADMIN'
    ON CONFLICT DO NOTHING;
  `);

  /*
   * OPERATIONS MANAGER
   */

  await assignPermissions("OPERATIONS_MANAGER", [
    "leads.read",
    "leads.create",
    "leads.update",
    "leads.delete",
    "leads.assign",

    "customers.read",
    "customers.create",
    "customers.update",
    "customers.delete",
    "customers.assign",

    "services.read",
    "services.create",
    "services.update",
    "services.delete",

    "users.read",
    "users.create",
    "users.update",

    "organization.read",

    "reports.read",
    "reports.all",
  ]);

  /*
   * MARKETING MANAGER
   */

  await assignPermissions("MARKETING_MANAGER", [
    "leads.read",
    "leads.create",
    "leads.update",
    "leads.delete",

    "customers.read",

    "services.read",

    "reports.read",
  ]);

  /*
   * MARKETING SPECIALIST
   */

  await assignPermissions("MARKETING_SPECIALIST", [
    "leads.read",
    "leads.create",
    "leads.update",

    "customers.read",

    "services.read",
  ]);

  /*
   * SALES MANAGER
   */

  await assignPermissions("SALES_MANAGER", [
    "leads.read",
    "leads.create",
    "leads.update",
    "leads.delete",
    "leads.assign",

    "customers.read",
    "customers.create",
    "customers.update",
    "customers.assign",

    "services.read",

    "reports.read",
    "reports.all",
  ]);

  /*
   * SALES REPRESENTATIVE
   */

  await assignPermissions("SALES_REP", [
    "leads.read",
    "leads.create",
    "leads.update",

    "customers.read",
    "customers.create",
    "customers.update",

    "services.read",
  ]);

  /*
   * CUSTOMER SUPPORT AGENT
   */

  await assignPermissions("CUSTOMER_SUPPORT_AGENT", [
    "customers.read",
    "customers.update",

    "services.read",
    "services.update",
  ]);

  /*
   * CUSTOMER SUCCESS MANAGER
   */

  await assignPermissions("CUSTOMER_SUCCESS_MANAGER", [
    "leads.read",

    "customers.read",
    "customers.create",
    "customers.update",

    "services.read",

    "reports.read",
  ]);

  console.log("[DB] Identity database tables ready");
  console.log("[DB] Roles and permissions ready");
}

/*
 * =========================================================
 * HELPER
 * =========================================================
 */

async function assignPermissions(roleCode, permissionCodes) {
  if (!permissionCodes.length) {
    return;
  }

  await pool.query(
    `
    INSERT INTO role_permissions
      (role_id, permission_id)

    SELECT
      r.id,
      p.id

    FROM roles r

    CROSS JOIN permissions p

    WHERE
      r.code = $1
      AND p.code = ANY($2::text[])

    ON CONFLICT DO NOTHING
    `,
    [roleCode, permissionCodes],
  );
}

module.exports = {
  initializeDatabase,
};
