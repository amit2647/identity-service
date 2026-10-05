const express = require("express");

const authenticate = require("../middleware/authenticate");
const requirePermission = require("../middleware/requirePermission");
const controller = require("../controllers/bundleInstallController");

const router = express.Router();

/*
 * Install steps for a profession bundle, called by bundle-service with the
 * installing admin's token. bundles.manage is settings-level (SUPER_ADMIN),
 * and role templates are additionally refused any system.* permission.
 */
router.put(
  "/permissions/bundles/:key/:version",
  authenticate,
  requirePermission("bundles.manage"),
  controller.installPermissions,
);

router.put(
  "/roles/bundles/:key/:version",
  authenticate,
  requirePermission("bundles.manage"),
  controller.installRoles,
);

module.exports = router;
