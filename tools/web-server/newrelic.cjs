'use strict';
exports.config = {
  app_name: [process.env.NEW_RELIC_APP_NAME || 'claude-code-workflow'],
  license_key: process.env.NEW_RELIC_LICENSE_KEY || '',
  agent_enabled: !!(process.env.NEW_RELIC_LICENSE_KEY),
  logging: { level: 'info', filepath: 'stdout' },
  distributed_tracing: { enabled: true },
  allow_all_headers: true,
  attributes: {
    exclude: [
      'request.headers.cookie',
      'request.headers.authorization',
      'request.headers.proxyAuthorization',
    ],
  },
};
