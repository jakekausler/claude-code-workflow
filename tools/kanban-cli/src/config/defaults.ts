import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { pipelineConfigSchema } from './schema.js';
import type { PipelineConfig } from '../types/pipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultYamlPath = path.resolve(__dirname, '../../config/default-pipeline.yaml');

function loadDefaultConfig(): PipelineConfig {
  const raw = fs.readFileSync(defaultYamlPath, 'utf-8');
  const parsed = parseYaml(raw);
  const result = pipelineConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid default pipeline config: ${result.error.issues.map((i) => i.message).join(', ')}`
    );
  }
  return result.data;
}

export const defaultPipelineConfig: PipelineConfig = loadDefaultConfig();
