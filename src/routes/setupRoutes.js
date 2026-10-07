const express = require("express");

const setupService = require("../services/setupService");

const router = express.Router();

/*
 * First-run setup (see setupService). Both routes are unauthenticated: no
 * account exists yet. POST /setup needs the one-time code from the migrate
 * log and is refused for good once an administrator exists.
 */

function respond(work) {
  return async (req, res) => {
    try {
      return res.json(await work(req));
    } catch (error) {
      if (!error.statusCode) console.error("[Setup]", error);

      return res.status(error.statusCode || 500).json({
        error: error.statusCode ? error.message : "Setup failed",
        ...(error.details ? { details: error.details } : {}),
      });
    }
  };
}

router.get("/setup/status", respond(() => setupService.status()));

router.post("/setup", respond((req) => setupService.complete(req.body || {})));

module.exports = router;
