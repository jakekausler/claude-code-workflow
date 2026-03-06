/**
 * Types for the old-format-to-new-format migration.
 */

/**
 * An old-format stage file parsed from a legacy repo.
 * Old format has no YAML frontmatter; data is extracted from markdown structure.
 */
export interface OldFormatStage {
  /** Original filename, e.g. "STAGE-001-003.md" */
  filename: string;
  /** Absolute path to the file */
  filePath: string;
  /** Old two-level ID, e.g. "STAGE-001-003" */
  oldId: string;
  /** Epic number extracted from ID, e.g. "001" */
  epicNum: string;
  /** Stage number extracted from ID, e.g. "003" */
  stageNum: string;
  /** Title extracted from first `# ` header, or filename if none */
  title: string;
  /** Status extracted from `## Status` section, or "Not Started" */
  status: string;
  /** Raw markdown body (everything after the title header) */
  body: string;
}

/**
 * An old-format epic directory detected in the repo.
 */
export interface OldFormatEpic {
  /** Epic ID, e.g. "EPIC-001" */
  id: string;
  /** Epic number, e.g. "001" */
  epicNum: string;
  /** Absolute path to the epic directory */
  dirPath: string;
  /** Title extracted from epic markdown (if exists) or derived from dir name */
  title: string;
  /** Status of the epic, inferred or parsed */
  status: string;
  /** All stage files found directly in the epic directory */
  stages: OldFormatStage[];
  /** Whether an epic markdown file already existed */
  hadEpicFile: boolean;
}

/**
 * ID mapping from old two-level IDs to new three-level IDs.
 */
export interface IdMapping {
  oldStageId: string;
  newStageId: string;
  ticketId: string;
  epicId: string;
}

/**
 * Result of migrating a single epic.
 */
export interface EpicMigrationResult {
  id: string;
  title: string;
  tickets_created: number;
  stages_migrated: number;
  dependencies_inferred: number;
}

/**
 * Full migration result, serialized as JSON output.
 */
export interface MigrationResult {
  migrated: boolean;
  dry_run: boolean;
  epics: EpicMigrationResult[];
  total_stages_migrated: number;
  total_tickets_created: number;
  total_dependencies_inferred: number;
  warnings: string[];
}

/**
 * Input to the migration engine.
 */
export interface MigrateInput {
  repoPath: string;
  dryRun: boolean;
}
