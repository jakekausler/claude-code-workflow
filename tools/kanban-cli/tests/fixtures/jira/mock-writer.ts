/**
 * Mock Jira writing script for tests.
 * Reads JSON from stdin, returns appropriate mock responses based on operation.
 */

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

async function main() {
  const raw = await readStdin();
  const input = JSON.parse(raw);

  switch (input.operation) {
    case 'transition-ticket':
      console.log(JSON.stringify({
        key: input.key,
        success: true,
        previous_status: 'To Do',
        new_status: input.target_status,
      }));
      break;

    case 'assign-ticket':
      console.log(JSON.stringify({
        key: input.key,
        success: true,
      }));
      break;

    case 'add-comment':
      console.log(JSON.stringify({
        key: input.key,
        success: true,
        comment_id: '12345',
      }));
      break;

    default:
      process.stderr.write(JSON.stringify({ error: `Unknown operation: ${input.operation}` }));
      process.exit(1);
  }
}

main();
