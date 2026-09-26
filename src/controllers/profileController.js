const profileService = require("../services/profileService");

function toProfile(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    status: row.status,
    isGuest: row.is_guest,
    role: row.role_name,
    roleCode: row.role_code,
    organization: row.organization_name,
    createdAt: row.created_at,
  };
}

function fail(res, error, fallback) {
  if (error.statusCode) {
    return res.status(error.statusCode).json({ error: error.message });
  }

  console.error(`[Profile] ${fallback}:`, error);

  return res.status(500).json({ error: fallback });
}

async function getProfile(req, res) {
  try {
    return res.json(toProfile(await profileService.getProfile(req.auth)));
  } catch (error) {
    return fail(res, error, "Could not load your profile");
  }
}

async function updateProfile(req, res) {
  try {
    const profile = await profileService.updateProfile(req.auth, {
      name: req.body?.name,
      email: req.body?.email,
      currentPassword: req.body?.currentPassword,
    });

    return res.json(toProfile(profile));
  } catch (error) {
    return fail(res, error, "Could not update your profile");
  }
}

async function changePassword(req, res) {
  try {
    await profileService.changePassword(req.auth, {
      currentPassword: req.body?.currentPassword,
      newPassword: req.body?.newPassword,
    });

    return res.status(204).end();
  } catch (error) {
    return fail(res, error, "Could not change your password");
  }
}

module.exports = { getProfile, updateProfile, changePassword };
