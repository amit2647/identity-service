const authService = require("../services/authService");

async function login(req, res) {
  try {
    const { email, password } = req.body;

    /*
     * Validate email.
     */

    if (typeof email !== "string" || !email.trim()) {
      return res.status(400).json({
        error: "Email is required",
      });
    }

    /*
     * Validate password.
     */

    if (typeof password !== "string" || !password) {
      return res.status(400).json({
        error: "Password is required",
      });
    }

    const result = await authService.login(email, password);

    res.json(result);
  } catch (error) {
    console.error("[AUTH] Login failed:", error.message);

    res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : "Authentication failed",
    });
  }
}

module.exports = {
  login,
};
