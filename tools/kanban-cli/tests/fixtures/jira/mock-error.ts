/**
 * Mock script that exits with non-zero code and JSON error on stderr.
 */
process.stderr.write(JSON.stringify({ error: 'Authentication failed: invalid API token' }));
process.exit(1);
