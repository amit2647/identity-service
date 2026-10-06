const bundleInstallService = require("../services/bundleInstallService");
const { choicesOf } = require("../services/bundleSync");

const KEY = /^[a-z][a-z0-9-]{1,59}$/;
const VERSION = /^\d+\.\d+\.\d+$/;

function params(req) {
  const { key, version } = req.params;

  if (!KEY.test(key) || !VERSION.test(version)) {
    const error = new Error("Invalid bundle key or version");
    error.statusCode = 400;
    throw error;
  }

  return { key, version };
}

function handleError(res, error) {
  console.error("[Bundle Install]", error.message);

  return res.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : "Bundle install step failed",
    ...(error.details ? { details: error.details } : {}),
  });
}

async function installPermissions(req, res) {
  try {
    const { key } = params(req);
    const result = await bundleInstallService.installPermissions(key, req.body || {}, choicesOf(req));

    return res.json(result);
  } catch (error) {
    return handleError(res, error);
  }
}

async function installRoles(req, res) {
  try {
    const { key, version } = params(req);
    const result = await bundleInstallService.installRoles(req.auth.organizationId, key, version, req.body || {}, choicesOf(req));

    return res.json(result);
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = { installPermissions, installRoles };
