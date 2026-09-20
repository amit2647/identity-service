const express = require("express");

const authenticate = require("../middleware/authenticate");
const requirePermission = require("../middleware/requirePermission");
const controller = require("../controllers/accessGrantController");

const router = express.Router();

/*
 * Granting a permission is privilege escalation by nature — whoever can do it
 * can grant it to themselves — so writes are gated on system.settings, which
 * only SUPER_ADMIN holds. Same reasoning as role editing.
 */
router.get(
  "/access-grants",
  authenticate,
  requirePermission("users.read"),
  controller.getGrants,
);

router.post(
  "/access-grants",
  authenticate,
  requirePermission("system.settings"),
  controller.createGrant,
);

router.post(
  "/access-grants/:id/revoke",
  authenticate,
  requirePermission("system.settings"),
  controller.revokeGrant,
);

module.exports = router;
