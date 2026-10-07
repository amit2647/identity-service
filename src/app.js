const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/authRoutes");
const authTestRoutes = require("./routes/authTestRoutes");
const organizationRoutes = require("./routes/organizationRoutes");
const firmRoutes = require("./routes/firmRoutes");
const userRoutes = require("./routes/userRoutes");
const profileRoutes = require("./routes/profileRoutes");
const roleRoutes = require("./routes/roleRoutes");
const bundleInstallRoutes = require("./routes/bundleInstallRoutes");
const accessGrantRoutes = require("./routes/accessGrantRoutes");
const setupRoutes = require("./routes/setupRoutes");
const app = express();

app.use(cors());

app.use(express.json());

app.get("/health", async (req, res) => {
  res.json({
    service: "identity-service",
    status: "ok",
    database: "postgresql",
  });
});

/* Routes */
// First-run setup: public, and closed once an administrator exists.
app.use(setupRoutes);

app.use(authRoutes);

app.use(authTestRoutes);

// /organizations/current/… before /organizations/:id.
app.use(firmRoutes);

app.use(organizationRoutes);

app.use(bundleInstallRoutes);

app.use(roleRoutes);

app.use(accessGrantRoutes);

app.use(userRoutes);

app.use(profileRoutes);

module.exports = app;
