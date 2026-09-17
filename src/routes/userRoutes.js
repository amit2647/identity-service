const express = require("express");

const authenticate = require("../middleware/authenticate");
const requirePermission = require("../middleware/requirePermission");
const controller = require("../controllers/userController");

const router = express.Router();

router.get(
  "/users/:id",
  authenticate,
  requirePermission("users.read"),
  controller.getUser,
);

router.post(
  "/users",
  authenticate,
  requirePermission("users.create"),
  controller.createUser,
);

router.put(
  "/users/:id",
  authenticate,
  requirePermission("users.update"),
  controller.updateUser,
);

router.delete(
  "/users/:id",
  authenticate,
  requirePermission("users.delete"),
  controller.deleteUser,
);

// Reference data for assigning a role to a user.
router.get(
  "/roles",
  authenticate,
  requirePermission("users.read"),
  controller.getRoles,
);

router.get(
  "/permissions",
  authenticate,
  requirePermission("users.read"),
  controller.getPermissions,
);

module.exports = router;
