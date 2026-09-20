const accessGrantService = require("../services/accessGrantService");

function getOrganizationId(req) {
  const organizationId = Number(req.auth?.organizationId);

  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    const error = new Error("Authenticated organization is required");
    error.statusCode = 401;
    throw error;
  }

  return organizationId;
}

function handleError(res, error) {
  console.error("[Access Grant Controller]", error);

  // permission_code is a foreign key onto permissions.code, so an unknown one
  // surfaces as 23503 rather than a validation error.
  if (error.code === "23503") {
    return res.status(400).json({ error: "That permission does not exist" });
  }

  return res.status(error.statusCode || 500).json({
    error: error.message || "Internal server error",
  });
}

async function getGrants(req, res) {
  try {
    const grants = await accessGrantService.listGrants(getOrganizationId(req));

    return res.json({
      grants,
      count: grants.length,
      maxDurationMinutes: accessGrantService.MAX_DURATION_MINUTES,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function createGrant(req, res) {
  try {
    const grants = await accessGrantService.createGrant(
      getOrganizationId(req),
      req.auth?.userId,
      req.body || {},
    );

    return res.status(201).json({ grants, count: grants.length });
  } catch (error) {
    return handleError(res, error);
  }
}

async function revokeGrant(req, res) {
  try {
    const grant = await accessGrantService.revokeGrant(
      getOrganizationId(req),
      Number(req.params.id),
      req.auth?.userId,
    );

    return res.json({ grant });
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = { getGrants, createGrant, revokeGrant };
