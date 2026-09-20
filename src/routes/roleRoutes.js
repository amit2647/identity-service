const express = require("express");

const authenticate = require("../middleware/authenticate");
const requirePermission = require("../middleware/requirePermission");
const controller = require("../controllers/roleController");

const router = express.Router();

/*
 * Reading roles needs only users.read — assigning one to a user requires seeing
 * the list. Everything that changes a role is gated on system.settings, held
 * by SUPER_ADMIN alone: editing role permissions is privilege escalation by
 * nature, since whoever can do it can grant their own role anything.
 */
router.get("/roles", authenticate, requirePermission("users.read"), controller.getRoles);

router.get("/roles/:id", authenticate, requirePermission("users.read"), controller.getRole);

router.post("/roles", authenticate, requirePermission("system.settings"), controller.createRole);

router.put("/roles/:id", authenticate, requirePermission("system.settings"), controller.updateRole);

router.put(
  "/roles/:id/permissions",
  authenticate,
  requirePermission("system.settings"),
  controller.updateRolePermissions,
);

router.delete(
  "/roles/:id",
  authenticate,
  requirePermission("system.settings"),
  controller.deleteRole,
);

module.exports = router;
