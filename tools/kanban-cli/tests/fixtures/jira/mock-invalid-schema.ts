/**
 * Mock script that exits 0 and outputs valid JSON that doesn't match the expected schema.
 */
console.log(JSON.stringify({ unexpected_field: true, count: 42 }));
