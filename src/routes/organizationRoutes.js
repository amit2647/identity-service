const express = require("express");

const authenticate = require("../middleware/authenticate");
const requirePermission = require("../middleware/requirePermission");
const controller = require("../controllers/organizationController");

const router = express.Router();

router.get(
  "/organizations",
  authenticate,
  requirePermission("organization.read"),
  controller.getOrganizations,
);

router.get(
  "/organizations/:id",
  authenticate,
  requirePermission("organization.read"),
  controller.getOrganization,
);

// Creating a tenant is a platform-level operation, so it requires system.settings
// rather than an organization.* permission; only SUPER_ADMIN holds it.
router.post(
  "/organizations",
  authenticate,
  requirePermission("system.settings"),
  controller.createOrganization,
);

router.put(
  "/organizations/:id",
  authenticate,
  requirePermission("organization.update"),
  controller.updateOrganization,
);

router.get(
  "/organizations/:id/users",
  authenticate,
  requirePermission("users.read"),
  controller.getOrganizationUsers,
);

module.exports = router;
