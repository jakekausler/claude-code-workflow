/**
 * Mock script that exits with non-zero code and raw text (not JSON) on stderr.
 */
process.stderr.write('Something went terribly wrong');
process.exit(2);
