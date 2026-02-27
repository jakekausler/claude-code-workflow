import { KanbanDatabase } from '../../../../kanban-cli/dist/db/database.js';
import {
  RepoRepository,
  EpicRepository,
  TicketRepository,
  StageRepository,
  DependencyRepository,
  StageSessionRepository,
  TicketSessionRepository,
} from '../../../../kanban-cli/dist/db/repositories/index.js';

export interface DataServiceOptions {
  db: KanbanDatabase;
}

/**
 * Wraps kanban-cli's database and repository access into a single
 * service object that Fastify route plugins can consume.
 */
export class DataService {
  readonly database: KanbanDatabase;
  readonly repos: RepoRepository;
  readonly epics: EpicRepository;
  readonly tickets: TicketRepository;
  readonly stages: StageRepository;
  readonly dependencies: DependencyRepository;
  readonly stageSessions: StageSessionRepository;
  readonly ticketSessions: TicketSessionRepository;

  constructor(options: DataServiceOptions) {
    this.database = options.db;
    this.repos = new RepoRepository(options.db);
    this.epics = new EpicRepository(options.db);
    this.tickets = new TicketRepository(options.db);
    this.stages = new StageRepository(options.db);
    this.dependencies = new DependencyRepository(options.db);
    this.stageSessions = new StageSessionRepository(options.db);
    this.ticketSessions = new TicketSessionRepository(options.db);
  }

  /** Close the underlying database connection. */
  close(): void {
    this.database.close();
  }
}
