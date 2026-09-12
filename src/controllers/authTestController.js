function getCurrentUser(req, res) {
  return res.json({
    authenticated: true,
    user: req.auth,
  });
}

module.exports = {
  getCurrentUser,
};
