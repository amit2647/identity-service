const userService = require("../services/userService");

/*
 * True when the target user is a member of the caller's organization.
 *
 * Callers report a miss as 404 rather than 403 so the response does not confirm
 * that a user id exists in some other tenant.
 */
async function targetInCallerOrganization(req) {
  const organizationId = Number(req.auth?.organizationId);

  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    return false;
  }

  return userService.isUserInOrganization(req.params.id, organizationId);
}

async function getUser(req, res) {
  try {
    if (!(await targetInCallerOrganization(req))) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    const user = await userService.getUserById(req.params.id);

    if (!user) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    res.json(user);
  } catch (error) {
    console.error("[ERROR] Error fetching user:", error);

    res.status(500).json({
      error: "Failed to fetch user",
    });
  }
}

async function createUser(req, res) {
  try {
    const { name, email, password, roleCode, status = "Active" } = req.body;

    // Taken from the token, never the body: a caller must not be able to plant a
    // user in another organization.
    const organizationId = Number(req.auth?.organizationId);

    if (!Number.isInteger(organizationId) || organizationId <= 0) {
      return res.status(401).json({
        error: "Authenticated organization is required",
      });
    }

    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        error: "User name is required",
      });
    }

    if (typeof email !== "string" || !email.trim()) {
      return res.status(400).json({
        error: "User email is required",
      });
    }

    if (typeof password !== "string" || password.length < 8) {
      return res.status(400).json({
        error: "Password must be at least 8 characters",
      });
    }

    if (typeof roleCode !== "string" || !roleCode.trim()) {
      return res.status(400).json({
        error: "Role is required",
      });
    }

    const user = await userService.createUser({
      name,
      email,
      password,
      organizationId,
      roleCode,
      status,
    });

    res.status(201).json(user);
  } catch (error) {
    console.error("[ERROR] Error creating user:", error);

    if (error.code === "23505") {
      return res.status(409).json({
        error: "A user with this email already exists",
      });
    }

    res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : "Failed to create user",
    });
  }
}

async function updateUser(req, res) {
  try {
    if (!(await targetInCallerOrganization(req))) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    const { name, email, status } = req.body;

    if (name !== undefined && (typeof name !== "string" || !name.trim())) {
      return res.status(400).json({
        error: "User name cannot be empty",
      });
    }

    const user = await userService.updateUser(req.params.id, {
      name,
      email,
      status,
    });

    if (!user) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    res.json(user);
  } catch (error) {
    console.error("[ERROR] Error updating user:", error);

    if (error.code === "23505") {
      return res.status(409).json({
        error: "A user with this email already exists",
      });
    }

    res.status(500).json({
      error: "Failed to update user",
    });
  }
}

async function deleteUser(req, res) {
  try {
    if (!(await targetInCallerOrganization(req))) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    const user = await userService.deleteUser(req.params.id);

    if (!user) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    res.json({
      message: "User deleted",
      id: user.id,
    });
  } catch (error) {
    console.error("[ERROR] Error deleting user:", error);

    res.status(500).json({
      error: "Failed to delete user",
    });
  }
}

async function getRoles(req, res) {
  try {
    const roles = await userService.getRoles();

    res.json(roles);
  } catch (error) {
    console.error("[ERROR] Error fetching roles:", error);

    res.status(500).json({
      error: "Failed to fetch roles",
    });
  }
}

async function getPermissions(req, res) {
  try {
    const permissions = await userService.getPermissions();

    res.json(permissions);
  } catch (error) {
    console.error("[ERROR] Error fetching permissions:", error);

    res.status(500).json({
      error: "Failed to fetch permissions",
    });
  }
}

module.exports = {
  getUser,
  createUser,
  updateUser,
  deleteUser,
  getRoles,
  getPermissions,
};
