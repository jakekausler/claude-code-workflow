/**
 * Mock script that sleeps forever for timeout testing.
 */
setTimeout(() => {
  // Never resolves — the executor should kill this process
}, 999_999_999);
