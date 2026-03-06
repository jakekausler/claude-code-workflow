import type { KanbanDatabase } from '../../../../kanban-cli/dist/db/database.js';
import type { Pool } from 'pg';
import type {
  IRepoRepository,
  IEpicRepository,
  ITicketRepository,
  IStageRepository,
  IDependencyRepository,
  IStageSessionRepository,
  ITicketSessionRepository,
} from './repositories/types.js';
import { createSqliteRepositories } from './repositories/sqlite/index.js';
import { createPgRepositories } from './repositories/pg/index.js';

export interface DataServiceRepositories {
  repos: IRepoRepository;
  epics: IEpicRepository;
  tickets: ITicketRepository;
  stages: IStageRepository;
  dependencies: IDependencyRepository;
  stageSessions: IStageSessionRepository;
  ticketSessions: ITicketSessionRepository;
}

/**
 * Wraps repository access into a single service object that Fastify
 * route plugins can consume.  Backend-agnostic — works with SQLite
 * (local mode) or PostgreSQL (hosted mode).
 */
export class DataService {
  readonly repos: IRepoRepository;
  readonly epics: IEpicRepository;
  readonly tickets: ITicketRepository;
  readonly stages: IStageRepository;
  readonly dependencies: IDependencyRepository;
  readonly stageSessions: IStageSessionRepository;
  readonly ticketSessions: ITicketSessionRepository;

  private _close: () => void;

  private constructor(repositories: DataServiceRepositories, close: () => void) {
    this.repos = repositories.repos;
    this.epics = repositories.epics;
    this.tickets = repositories.tickets;
    this.stages = repositories.stages;
    this.dependencies = repositories.dependencies;
    this.stageSessions = repositories.stageSessions;
    this.ticketSessions = repositories.ticketSessions;
    this._close = close;
  }

  /**
   * Create a DataService backed by a kanban-cli SQLite database.
   */
  static fromSqlite(db: KanbanDatabase): DataService {
    const repositories = createSqliteRepositories(db);
    return new DataService(repositories, () => db.close());
  }

  /**
   * Create a DataService backed by a PostgreSQL connection pool.
   */
  static fromPool(pool: Pool): DataService {
    const repositories = createPgRepositories(pool);
    // Pool lifecycle is managed by HostedDeploymentContext, not DataService
    return new DataService(repositories, () => {});
  }

  /** Close the underlying database connection (SQLite only). */
  close(): void {
    this._close();
  }
}

// Re-export for backward compatibility — old constructor pattern
export interface DataServiceOptions {
  db: KanbanDatabase;
}
