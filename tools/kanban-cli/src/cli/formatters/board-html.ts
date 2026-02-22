import type { BoardOutput, BoardItem, TicketBoardItem, StageBoardItem } from '../logic/board.js';

/**
 * Column color configuration. System columns have fixed colors;
 * pipeline columns cycle through purple/teal shades.
 */
const SYSTEM_COLUMN_COLORS: Record<string, { bg: string; header: string }> = {
  to_convert: { bg: '#fff3e0', header: '#e65100' },
  backlog: { bg: '#f5f5f5', header: '#616161' },
  ready_for_work: { bg: '#e3f2fd', header: '#1565c0' },
  done: { bg: '#e8f5e9', header: '#2e7d32' },
};

const PIPELINE_COLORS = [
  { bg: '#f3e5f5', header: '#6a1b9a' },
  { bg: '#e0f2f1', header: '#00695c' },
  { bg: '#ede7f6', header: '#4527a0' },
  { bg: '#e0f7fa', header: '#00838f' },
  { bg: '#fce4ec', header: '#880e4f' },
  { bg: '#e8eaf6', header: '#283593' },
];

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function columnDisplayName(key: string): string {
  return key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function getColumnColor(key: string, pipelineIndex: number): { bg: string; header: string } {
  if (SYSTEM_COLUMN_COLORS[key]) {
    return SYSTEM_COLUMN_COLORS[key];
  }
  return PIPELINE_COLORS[pipelineIndex % PIPELINE_COLORS.length];
}

function renderTicketCard(item: TicketBoardItem): string {
  return `
      <div class="card ticket-card">
        <div class="card-id">${escapeHtml(item.id)}</div>
        <div class="card-title">${escapeHtml(item.title)}</div>
        <div class="card-meta">
          ${item.epic ? `<span class="badge badge-epic">${escapeHtml(item.epic)}</span>` : ''}
          <span class="badge badge-source">${escapeHtml(item.source)}</span>
          ${item.jira_key ? `<span class="badge badge-jira">${escapeHtml(item.jira_key)}</span>` : ''}
        </div>
      </div>`;
}

function renderStageCard(item: StageBoardItem): string {
  const hasPendingMerge = item.pending_merge_parents && item.pending_merge_parents.length > 0;
  const pendingMergeTitle = hasPendingMerge
    ? `Pending merge: ${item.pending_merge_parents!.map((p) => p.stage_id).join(', ')}`
    : '';
  return `
      <div class="card stage-card">
        <div class="card-header-row">
          <div class="card-id">${escapeHtml(item.id)}</div>
          ${item.session_active ? '<span class="session-dot" title="Session active"></span>' : ''}
        </div>
        <div class="card-title">${escapeHtml(item.title)}${hasPendingMerge ? ` <span class="pending-merge" title="${escapeHtml(pendingMergeTitle)}">⚠️</span>` : ''}</div>
        <div class="card-meta">
          <span class="badge badge-ticket">${escapeHtml(item.ticket)}</span>
          ${item.epic ? `<span class="badge badge-epic">${escapeHtml(item.epic)}</span>` : ''}
          ${item.blocked_by && item.blocked_by.length > 0 ? `<span class="badge badge-blocked">Blocked</span>` : ''}
          ${item.worktree_branch ? `<span class="badge badge-branch" title="${escapeHtml(item.worktree_branch)}">branch</span>` : ''}
        </div>
      </div>`;
}

function renderCard(item: BoardItem): string {
  if (item.type === 'ticket') {
    return renderTicketCard(item);
  }
  return renderStageCard(item);
}

/**
 * Render a BoardOutput as a standalone HTML page string.
 */
export function renderBoardHtml(board: BoardOutput): string {
  const columnKeys = Object.keys(board.columns);

  // Identify pipeline columns (anything not in SYSTEM_COLUMN_COLORS)
  let pipelineIdx = 0;
  const columnColors: Record<string, { bg: string; header: string }> = {};
  for (const key of columnKeys) {
    if (SYSTEM_COLUMN_COLORS[key]) {
      columnColors[key] = SYSTEM_COLUMN_COLORS[key];
    } else {
      columnColors[key] = getColumnColor(key, pipelineIdx);
      pipelineIdx++;
    }
  }

  // Stats bar
  const statEntries = Object.entries(board.stats.by_column)
    .map(([col, count]) => `<span class="stat-item"><strong>${escapeHtml(columnDisplayName(col))}:</strong> ${count}</span>`)
    .join('');

  const statsHtml = `
    <div class="stats-bar">
      <span class="stat-item"><strong>Total Stages:</strong> ${board.stats.total_stages}</span>
      <span class="stat-item"><strong>Total Tickets:</strong> ${board.stats.total_tickets}</span>
      ${statEntries}
    </div>`;

  // Columns
  const columnsHtml = columnKeys
    .map((key) => {
      const items = board.columns[key];
      const color = columnColors[key];
      const cards = items.map((item) => renderCard(item)).join('');
      return `
      <div class="column" data-column="${escapeHtml(key)}">
        <div class="column-header" style="background-color: ${color.header};">
          <span class="column-name">${escapeHtml(columnDisplayName(key))}</span>
          <span class="column-count">${items.length}</span>
        </div>
        <div class="column-body" style="background-color: ${color.bg};">
          ${cards || '<div class="empty-column">No items</div>'}
        </div>
      </div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kanban Board - ${escapeHtml(board.repo)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #fafafa;
      color: #333;
      padding: 16px;
    }
    h1 {
      font-size: 1.4rem;
      margin-bottom: 8px;
    }
    .stats-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      padding: 10px 14px;
      background: #fff;
      border: 1px solid #ddd;
      border-radius: 6px;
      margin-bottom: 16px;
      font-size: 0.85rem;
    }
    .stat-item strong { margin-right: 4px; }
    .board {
      display: flex;
      gap: 12px;
      overflow-x: auto;
      padding-bottom: 12px;
    }
    .column {
      min-width: 260px;
      max-width: 320px;
      flex: 0 0 280px;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #ddd;
    }
    .column-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 12px;
      color: #fff;
      font-weight: 600;
      font-size: 0.9rem;
    }
    .column-count {
      background: rgba(255,255,255,0.3);
      border-radius: 10px;
      padding: 1px 8px;
      font-size: 0.8rem;
    }
    .column-body {
      padding: 8px;
      min-height: 60px;
    }
    .card {
      background: #fff;
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      padding: 10px;
      margin-bottom: 8px;
      box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }
    .card:last-child { margin-bottom: 0; }
    .card-header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .card-id {
      font-weight: 700;
      font-size: 0.8rem;
      color: #555;
      margin-bottom: 4px;
    }
    .card-title {
      font-size: 0.85rem;
      margin-bottom: 6px;
    }
    .card-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.7rem;
      font-weight: 500;
    }
    .badge-epic { background: #e8eaf6; color: #283593; }
    .badge-ticket { background: #e3f2fd; color: #1565c0; }
    .badge-source { background: #f5f5f5; color: #616161; }
    .badge-jira { background: #fff3e0; color: #e65100; }
    .badge-blocked { background: #ffebee; color: #c62828; }
    .badge-branch { background: #e8f5e9; color: #2e7d32; }
    .pending-merge { cursor: help; }
    .session-dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #fdd835;
      border: 1px solid #f9a825;
      flex-shrink: 0;
    }
    .empty-column {
      text-align: center;
      color: #999;
      font-size: 0.8rem;
      padding: 16px 0;
    }
    footer {
      margin-top: 20px;
      font-size: 0.75rem;
      color: #999;
      text-align: center;
    }
  </style>
</head>
<body>
  <h1>Kanban Board</h1>
  ${statsHtml}
  <div class="board">
    ${columnsHtml}
  </div>
  <footer>Generated ${escapeHtml(board.generated_at)} &mdash; ${escapeHtml(board.repo)}</footer>
</body>
</html>`;
}
