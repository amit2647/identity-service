const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/authRoutes");
const authTestRoutes = require("./routes/authTestRoutes");
const organizationRoutes = require("./routes/organizationRoutes");
const userRoutes = require("./routes/userRoutes");
const roleRoutes = require("./routes/roleRoutes");
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
app.use(authRoutes);

app.use(authTestRoutes);

app.use(organizationRoutes);

app.use(roleRoutes);

app.use(userRoutes);

module.exports = app;
