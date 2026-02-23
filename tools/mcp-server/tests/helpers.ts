export function parseResult(result: {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}) {
  return JSON.parse(result.content[0].text);
}
