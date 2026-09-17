const app = require("./app");
const pool = require("./config/database");

const PORT = process.env.PORT || 4004;

async function startServer() {
  try {
    await pool.query("SELECT 1");

    console.log("[DB] PostgreSQL connection successful");

    app.listen(PORT, () => {
      console.log(`Identity service running on port ${PORT}`);
    });
  } catch (error) {
    console.error("[ERROR] Identity service startup failed");
    console.error(error);

    process.exit(1);
  }
}

startServer();
