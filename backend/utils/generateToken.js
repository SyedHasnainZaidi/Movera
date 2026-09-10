const jwt = require('jsonwebtoken');

const generateToken = (id, role) => {
  return jwt.sign(
    { id, role },
    process.env.JWT_SECRET || 'supersecretphysiokey_2026_change_in_production',
    { expiresIn: '30d' }
  );
};

module.exports = generateToken;
