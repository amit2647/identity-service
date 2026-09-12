const organizationService = require("../services/organizationService");

async function getOrganizations(req, res) {
  try {
    const organizations = await organizationService.getAllOrganizations();

    res.json(organizations);
  } catch (error) {
    console.error("[ERROR] Error fetching organizations:", error);

    res.status(500).json({
      error: "Failed to fetch organizations",
    });
  }
}

async function getOrganization(req, res) {
  try {
    const organization = await organizationService.getOrganizationById(
      req.params.id,
    );

    if (!organization) {
      return res.status(404).json({
        error: "Organization not found",
      });
    }

    res.json(organization);
  } catch (error) {
    console.error("[ERROR] Error fetching organization:", error);

    res.status(500).json({
      error: "Failed to fetch organization",
    });
  }
}

async function createOrganization(req, res) {
  try {
    const { name, slug, status = "Active" } = req.body;

    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        error: "Organization name is required",
      });
    }

    if (typeof slug !== "string" || !slug.trim()) {
      return res.status(400).json({
        error: "Organization slug is required",
      });
    }

    const organization = await organizationService.createOrganization({
      name,
      slug,
      status,
    });

    res.status(201).json(organization);
  } catch (error) {
    console.error("[ERROR] Error creating organization:", error);

    if (error.code === "23505") {
      return res.status(409).json({
        error: "Organization slug already exists",
      });
    }

    res.status(500).json({
      error: "Failed to create organization",
    });
  }
}

async function updateOrganization(req, res) {
  try {
    const { name, slug, status } = req.body;

    if (name !== undefined && (typeof name !== "string" || !name.trim())) {
      return res.status(400).json({
        error: "Organization name cannot be empty",
      });
    }

    const organization = await organizationService.updateOrganization(
      req.params.id,
      {
        name,
        slug,
        status,
      },
    );

    if (!organization) {
      return res.status(404).json({
        error: "Organization not found",
      });
    }

    res.json(organization);
  } catch (error) {
    console.error("[ERROR] Error updating organization:", error);

    if (error.code === "23505") {
      return res.status(409).json({
        error: "Organization slug already exists",
      });
    }

    res.status(500).json({
      error: "Failed to update organization",
    });
  }
}

async function getOrganizationUsers(req, res) {
  try {
    const exists = await organizationService.organizationExists(req.params.id);

    if (!exists) {
      return res.status(404).json({
        error: "Organization not found",
      });
    }

    const users = await organizationService.getOrganizationUsers(req.params.id);

    res.json(users);
  } catch (error) {
    console.error("[ERROR] Error fetching organization users:", error);

    res.status(500).json({
      error: "Failed to fetch organization users",
    });
  }
}

module.exports = {
  getOrganizations,
  getOrganization,
  createOrganization,
  updateOrganization,
  getOrganizationUsers,
};
