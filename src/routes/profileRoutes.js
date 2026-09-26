const express = require("express");

const authenticate = require("../middleware/authenticate");
const controller = require("../controllers/profileController");

const router = express.Router();

/*
 * Signed in is enough: these act on the caller's own record only, identified
 * by the token (see profileService). Managing other people stays on /users.
 */
router.get("/profile", authenticate, controller.getProfile);

router.patch("/profile", authenticate, controller.updateProfile);

router.put("/profile/password", authenticate, controller.changePassword);

module.exports = router;
