const express = require("express");
const authenticate = require("../middleware/authenticate");
const requirePermission = require("../middleware/requirePermission");
const controller = require("../controllers/authTestController");

const router = express.Router();

router.get(
  "/auth/me",
  authenticate,
  requirePermission("organization.read"),
  controller.getCurrentUser,
);

module.exports = router;
