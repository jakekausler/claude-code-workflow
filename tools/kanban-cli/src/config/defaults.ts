import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type { PipelineConfig } from '../types/pipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultYamlPath = path.resolve(__dirname, '../../config/default-pipeline.yaml');

function loadDefaultConfig(): PipelineConfig {
  const raw = fs.readFileSync(defaultYamlPath, 'utf-8');
  return parseYaml(raw) as PipelineConfig;
}

export const defaultPipelineConfig: PipelineConfig = loadDefaultConfig();
