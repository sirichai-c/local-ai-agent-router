const { config } = require('../config/env');

function getHealth(request, response) {
  response.status(200).json({
    status: 'ok',
    service: config.serviceName,
  });
}

module.exports = { getHealth };
