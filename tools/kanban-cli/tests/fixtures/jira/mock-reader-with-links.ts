/**
 * Mock Jira reading script for tests.
 * Same as mock-reader but includes links in get-ticket responses.
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
    case 'get-ticket':
      console.log(JSON.stringify({
        key: input.key,
        summary: `Summary for ${input.key}`,
        description: `Description for ${input.key}`,
        status: 'In Progress',
        type: 'Story',
        parent: 'PROJ-1',
        assignee: 'alice',
        labels: ['backend', 'priority-high'],
        comments: [
          {
            author: 'bob',
            body: 'Looks good to me',
            created: '2024-01-15T10:00:00Z',
          },
        ],
        links: [
          {
            type: 'confluence',
            url: 'https://company.atlassian.net/wiki/spaces/TEAM/pages/123',
            title: 'Design Doc',
          },
          {
            type: 'jira_issue',
            url: 'https://company.atlassian.net/browse/PROJ-999',
            key: 'PROJ-999',
            title: 'Related Issue',
            relationship: 'blocks',
          },
          {
            type: 'attachment',
            url: 'https://company.atlassian.net/secure/attachment/456/spec.pdf',
            title: 'Spec PDF',
            filename: 'spec.pdf',
            mime_type: 'application/pdf',
          },
          {
            type: 'external',
            url: 'https://docs.google.com/document/d/abc123',
            title: 'External Doc',
          },
        ],
      }));
      break;

    case 'search-tickets':
      console.log(JSON.stringify({
        tickets: [
          {
            key: 'PROJ-10',
            summary: 'First result',
            status: 'To Do',
            type: 'Story',
          },
          {
            key: 'PROJ-11',
            summary: 'Second result',
            status: 'In Progress',
            type: 'Bug',
          },
        ],
      }));
      break;

    default:
      process.stderr.write(JSON.stringify({ error: `Unknown operation: ${input.operation}` }));
      process.exit(1);
  }
}

main();
