const roleService = require("../services/roleService");

function getOrganizationId(req) {
  const organizationId = Number(req.auth?.organizationId);

  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    const error = new Error("Authenticated organization is required");
    error.statusCode = 401;
    throw error;
  }

  return organizationId;
}

function getRoleId(req) {
  const roleId = Number(req.params.id);

  if (!Number.isInteger(roleId) || roleId <= 0) {
    const error = new Error("Invalid role ID");
    error.statusCode = 400;
    throw error;
  }

  return roleId;
}

function handleError(res, error) {
  console.error("[Role Controller]", error);

  if (error.code === "23505") {
    return res
      .status(409)
      .json({ error: "A role with this code already exists in your organization" });
  }

  return res.status(error.statusCode || 500).json({
    error: error.message || "Internal server error",
  });
}

async function getRoles(req, res) {
  try {
    const roles = await roleService.listRoles(getOrganizationId(req));

    return res.json(roles);
  } catch (error) {
    return handleError(res, error);
  }
}

async function getRole(req, res) {
  try {
    const role = await roleService.getRoleById(getOrganizationId(req), getRoleId(req));

    if (!role) {
      return res.status(404).json({ error: "Role not found" });
    }

    return res.json(role);
  } catch (error) {
    return handleError(res, error);
  }
}

async function createRole(req, res) {
  try {
    const role = await roleService.createRole(getOrganizationId(req), req.body || {});

    return res.status(201).json(role);
  } catch (error) {
    return handleError(res, error);
  }
}

async function updateRole(req, res) {
  try {
    const role = await roleService.updateRole(
      getOrganizationId(req),
      getRoleId(req),
      req.body || {},
    );

    return res.json(role);
  } catch (error) {
    return handleError(res, error);
  }
}

async function updateRolePermissions(req, res) {
  try {
    const role = await roleService.setRolePermissions(
      getOrganizationId(req),
      getRoleId(req),
      req.body?.permissionCodes,
    );

    return res.json(role);
  } catch (error) {
    return handleError(res, error);
  }
}

async function deleteRole(req, res) {
  try {
    await roleService.deleteRole(getOrganizationId(req), getRoleId(req));

    return res.status(204).send();
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  getRoles,
  getRole,
  createRole,
  updateRole,
  updateRolePermissions,
  deleteRole,
};
