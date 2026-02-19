import matter from 'gray-matter';

// ---------- Input data shapes ----------

export interface SummaryStageInput {
  id: string;
  title: string;
  status: string;
  file_content: string;
}

export interface BuildSummaryInput {
  stages: SummaryStageInput[];
}

// ---------- Output types ----------

export interface SummaryItem {
  id: string;
  title: string;
  status: string;
  design_decision: string | null;
  what_was_built: string | null;
  issues_encountered: string | null;
  commit_hash: string | null;
  mr_pr_url: string | null;
}

export interface SummaryOutput {
  items: SummaryItem[];
}

// ---------- Markdown body parser ----------

export interface ParsedStageBody {
  design_decision: string | null;
  what_was_built: string | null;
  issues_encountered: string | null;
  commit_hash: string | null;
  mr_pr_url: string | null;
}

/**
 * Split markdown body into sections by ## headings.
 * Returns a map of section name (lowercase) -> section content.
 */
function splitSections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = body.split('\n');
  let currentSection = '';
  let currentContent: string[] = [];

  for (const line of lines) {
    const match = line.match(/^## (.+)/);
    if (match) {
      if (currentSection) {
        sections.set(currentSection, currentContent.join('\n').trim());
      }
      currentSection = match[1].trim().toLowerCase();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  if (currentSection) {
    sections.set(currentSection, currentContent.join('\n').trim());
  }

  return sections;
}

/**
 * Extract a field value from a markdown section.
 * Looks for patterns like "- **Field Name**: value" or "**Field Name**: value".
 * Returns null if not found or if value is empty.
 */
function extractField(sectionContent: string, fieldName: string): string | null {
  const patterns = [
    new RegExp(`^-?[ \\t]*\\*\\*${fieldName}\\*\\*:[ \\t]*(.+)$`, 'mi'),
    new RegExp(`^\\*\\*${fieldName}\\*\\*:[ \\t]*(.+)$`, 'mi'),
  ];

  for (const pattern of patterns) {
    const match = sectionContent.match(pattern);
    if (match && match[1].trim()) {
      return match[1].trim();
    }
  }

  return null;
}

/**
 * Extract a multi-line value by collecting labeled bullet points from a section.
 * Collects content from fields like "Components Created", "API Endpoints Added", etc.
 */
function extractBuildSummary(sectionContent: string): string | null {
  const fields = ['Components Created', 'API Endpoints Added'];
  const parts: string[] = [];

  for (const field of fields) {
    const value = extractField(sectionContent, field);
    if (value) {
      parts.push(value);
    }
  }

  return parts.length > 0 ? parts.join('; ') : null;
}

/**
 * Parse the markdown body of a stage file to extract summary fields.
 */
export function parseStageBody(body: string): ParsedStageBody {
  const sections = splitSections(body);

  // Design decision from "User Choice" in Design Phase
  const designSection = sections.get('design phase') ?? '';
  const designDecision = extractField(designSection, 'User Choice');

  // What was built from Build Phase
  const buildSection = sections.get('build phase') ?? '';
  const whatWasBuilt = extractBuildSummary(buildSection);

  // Issues encountered from Session Notes in Build Phase
  const issuesEncountered = extractField(buildSection, 'Session Notes');

  // Commit hash and MR/PR URL from Finalize Phase
  const finalizeSection = sections.get('finalize phase') ?? '';
  const commitHash = extractField(finalizeSection, 'Commit Hash');
  const mrPrUrl = extractField(finalizeSection, 'MR/PR URL');

  return {
    design_decision: designDecision,
    what_was_built: whatWasBuilt,
    issues_encountered: issuesEncountered,
    commit_hash: commitHash,
    mr_pr_url: mrPrUrl,
  };
}

// ---------- Core logic ----------

export function buildSummary(input: BuildSummaryInput): SummaryOutput {
  const items: SummaryItem[] = input.stages.map((stage) => {
    const { content: body } = matter(stage.file_content);
    const parsed = parseStageBody(body);

    return {
      id: stage.id,
      title: stage.title,
      status: stage.status,
      design_decision: parsed.design_decision,
      what_was_built: parsed.what_was_built,
      issues_encountered: parsed.issues_encountered,
      commit_hash: parsed.commit_hash,
      mr_pr_url: parsed.mr_pr_url,
    };
  });

  return { items };
}
