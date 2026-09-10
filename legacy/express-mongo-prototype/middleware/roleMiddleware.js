const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        message: `Forbidden: Access restricted to roles [${roles.join(', ')}]`,
      });
    }
    next();
  };
};

module.exports = { authorize };
