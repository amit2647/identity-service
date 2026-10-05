const express = require("express");

const authenticate = require("../middleware/authenticate");
const requirePermission = require("../middleware/requirePermission");
const requireBundle = require("../middleware/requireBundle");
const firmService = require("../services/firmService");

const router = express.Router();

/*
 * The caller's own firm and its signing professionals (SET-01–03).
 * Organizations with a profession bundle only; always the caller's
 * organization, from the token. Declared before /organizations/:id.
 */

function respond(handler) {
  return async (req, res) => {
    try {
      const result = await handler(req, res);
      if (!res.headersSent) res.json(result ?? { ok: true });
    } catch (error) {
      if (!error.statusCode) console.error("[Firm]", error);
      res.status(error.statusCode || 500).json({
        error: error.statusCode ? error.message : "The firm could not be updated",
        ...(error.details ? { details: error.details } : {}),
      });
    }
  };
}

const id = (value) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    const error = new Error("Invalid id");
    error.statusCode = 400;
    throw error;
  }
  return number;
};

const read = [authenticate, requirePermission("organization.read"), requireBundle];
const write = [authenticate, requirePermission("organization.update"), requireBundle];

router.get("/organizations/current/profile", ...read, respond((req) => firmService.getFirm(req.auth.organizationId)));

router.put("/organizations/current/profile", ...write, respond((req) => firmService.updateFirm(req.auth, req.bundle, req.body || {})));

router.get("/organizations/current/professionals", ...read, respond((req) => firmService.listProfessionals(req.auth.organizationId)));

router.post(
  "/organizations/current/professionals",
  ...write,
  respond(async (req, res) => {
    res.status(201);
    return firmService.saveProfessional(req.auth, req.bundle, null, req.body || {});
  }),
);

router.put(
  "/organizations/current/professionals/:id",
  ...write,
  respond((req) => firmService.saveProfessional(req.auth, req.bundle, id(req.params.id), req.body || {})),
);

router.delete(
  "/organizations/current/professionals/:id",
  ...write,
  respond((req) => firmService.retireProfessional(req.auth, id(req.params.id))),
);

module.exports = router;
