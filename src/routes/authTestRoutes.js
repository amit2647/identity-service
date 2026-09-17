const express = require("express");
const authenticate = require("../middleware/authenticate");
const controller = require("../controllers/authTestController");

const router = express.Router();

// Authentication only, no permission: this returns req.auth, decoded from the
// caller's own token, so it discloses nothing the caller does not already hold.
// Requiring organization.read here locked out the six roles that lack it, and
// the frontend logs the user straight back out when this call fails.
router.get("/auth/me", authenticate, controller.getCurrentUser);

module.exports = router;
