export interface MockComment {
  id: string;
  body: string;
  author: string;
  createdAt: string;
}

export interface MockPR {
  number: number;
  url: string;
  title: string;
  body: string;
  branch: string;
  base: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  merged: boolean;
  assignees: string[];
  reviewers: string[];
  comments: MockComment[];
}

export interface MockTicket {
  key: string;
  summary: string;
  description: string | null;
  status: string;
  type: string;
  parent: string | null;
  assignee: string | null;
  labels: string[];
  comments: MockComment[];
}

export interface MockPage {
  pageId: string;
  title: string;
  body: string;
  url: string;
}

export interface MockSeedData {
  tickets: Record<string, Omit<MockTicket, 'comments'>>;
  pages: Record<string, MockPage>;
  prs: Record<number, Omit<MockPR, 'comments'>>;
}

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class MockState {
  private prs: Map<number, MockPR>;
  private tickets: Map<string, MockTicket>;
  private pages: Map<string, MockPage>;
  private nextPrNumber: number;
  private nextCommentId: number;

  constructor(seedData?: MockSeedData) {
    this.prs = new Map();
    this.tickets = new Map();
    this.pages = new Map();
    this.nextCommentId = 1;

    if (seedData) {
      for (const [key, ticket] of Object.entries(seedData.tickets)) {
        this.tickets.set(key, { ...ticket, comments: [] });
      }
      for (const [id, page] of Object.entries(seedData.pages)) {
        this.pages.set(id, { ...page });
      }
      let maxPrNumber = 0;
      for (const [numStr, pr] of Object.entries(seedData.prs)) {
        const num = Number(numStr);
        this.prs.set(num, { ...pr, comments: [] });
        if (num > maxPrNumber) {
          maxPrNumber = num;
        }
      }
      this.nextPrNumber = maxPrNumber > 0 ? maxPrNumber + 1 : 1000;
    } else {
      this.nextPrNumber = 1000;
    }
  }

  // PR operations

  createPr(input: {
    branch: string;
    title: string;
    body: string;
    base?: string;
    draft?: boolean;
    assignees?: string[];
    reviewers?: string[];
  }): { url: string; number: number } {
    const number = this.nextPrNumber++;
    const url = `https://github.com/mock-org/mock-repo/pull/${number}`;
    const pr: MockPR = {
      number,
      url,
      title: input.title,
      body: input.body,
      branch: input.branch,
      base: input.base ?? 'main',
      state: 'open',
      draft: input.draft ?? false,
      merged: false,
      assignees: input.assignees ?? [],
      reviewers: input.reviewers ?? [],
      comments: [],
    };
    this.prs.set(number, pr);
    return { url, number };
  }

  getPr(number: number): MockPR | null {
    const pr = this.prs.get(number);
    return pr ? deepCopy(pr) : null;
  }

  updatePr(
    number: number,
    updates: Partial<Pick<MockPR, 'title' | 'body' | 'base' | 'draft' | 'assignees' | 'reviewers'>>,
  ): boolean {
    const pr = this.prs.get(number);
    if (!pr) return false;
    if (updates.title !== undefined) pr.title = updates.title;
    if (updates.body !== undefined) pr.body = updates.body;
    if (updates.base !== undefined) pr.base = updates.base;
    if (updates.draft !== undefined) pr.draft = updates.draft;
    if (updates.assignees !== undefined) pr.assignees = [...updates.assignees];
    if (updates.reviewers !== undefined) pr.reviewers = [...updates.reviewers];
    return true;
  }

  closePr(number: number): boolean {
    const pr = this.prs.get(number);
    if (!pr) return false;
    pr.state = 'closed';
    return true;
  }

  setPrMerged(number: number): boolean {
    const pr = this.prs.get(number);
    if (!pr) return false;
    pr.state = 'merged';
    pr.merged = true;
    return true;
  }

  addPrComment(
    number: number,
    comment: { body: string; author?: string },
  ): MockComment | null {
    const pr = this.prs.get(number);
    if (!pr) return null;
    const newComment: MockComment = {
      id: `comment-${this.nextCommentId++}`,
      body: comment.body,
      author: comment.author ?? 'anonymous',
      createdAt: new Date().toISOString(),
    };
    pr.comments.push(newComment);
    return deepCopy(newComment);
  }

  getPrComments(number: number): MockComment[] {
    const pr = this.prs.get(number);
    if (!pr) return [];
    return deepCopy(pr.comments);
  }

  getPrStatus(
    number: number,
  ): { merged: boolean; hasUnresolvedComments: boolean; state: string } | null {
    const pr = this.prs.get(number);
    if (!pr) return null;
    return {
      merged: pr.merged,
      hasUnresolvedComments: pr.comments.length > 0,
      state: pr.state,
    };
  }

  // Jira operations

  getTicket(key: string): MockTicket | null {
    const ticket = this.tickets.get(key);
    return ticket ? deepCopy(ticket) : null;
  }

  searchTickets(jql: string): MockTicket[] {
    const lowerJql = jql.toLowerCase();
    const results: MockTicket[] = [];
    for (const ticket of this.tickets.values()) {
      if (
        ticket.key.toLowerCase().includes(lowerJql) ||
        ticket.summary.toLowerCase().includes(lowerJql)
      ) {
        results.push(deepCopy(ticket));
      }
    }
    return results;
  }

  transitionTicket(
    key: string,
    targetStatus: string,
  ): { success: boolean; previousStatus: string; newStatus: string } | null {
    const ticket = this.tickets.get(key);
    if (!ticket) return null;
    const previousStatus = ticket.status;
    ticket.status = targetStatus;
    return { success: true, previousStatus, newStatus: targetStatus };
  }

  assignTicket(key: string, assignee: string | null): boolean {
    const ticket = this.tickets.get(key);
    if (!ticket) return false;
    ticket.assignee = assignee;
    return true;
  }

  addTicketComment(
    key: string,
    comment: { body: string; author?: string },
  ): MockComment | null {
    const ticket = this.tickets.get(key);
    if (!ticket) return null;
    const newComment: MockComment = {
      id: `comment-${this.nextCommentId++}`,
      body: comment.body,
      author: comment.author ?? 'anonymous',
      createdAt: new Date().toISOString(),
    };
    ticket.comments.push(newComment);
    return deepCopy(newComment);
  }

  // Confluence

  getPage(pageId: string): MockPage | null {
    const page = this.pages.get(pageId);
    return page ? deepCopy(page) : null;
  }
}
