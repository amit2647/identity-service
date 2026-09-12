const express = require("express");

const controller = require("../controllers/organizationController");

const router = express.Router();

router.get("/organizations", controller.getOrganizations);

router.get("/organizations/:id", controller.getOrganization);

router.post("/organizations", controller.createOrganization);

router.put("/organizations/:id", controller.updateOrganization);

router.get("/organizations/:id/users", controller.getOrganizationUsers);

module.exports = router;
