import * as fs from 'node:fs';
import * as path from 'node:path';

export function writeOutput(content: string, outputPath?: string): void {
  if (outputPath) {
    const resolved = path.resolve(outputPath);
    const dir = path.dirname(resolved);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(resolved, content);
    process.stderr.write(`Written to ${resolved}\n`);
  } else {
    process.stdout.write(content);
  }
}
