const express = require("express");

const controller = require("../controllers/userController");

const router = express.Router();

router.get("/users/:id", controller.getUser);

router.post("/users", controller.createUser);

router.put("/users/:id", controller.updateUser);

router.delete("/users/:id", controller.deleteUser);

router.get("/roles", controller.getRoles);

router.get("/permissions", controller.getPermissions);

module.exports = router;
