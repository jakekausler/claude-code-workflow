import type {
  PipelineConfig,
  PipelineState,
  SkillState,
  ResolverState,
} from '../types/pipeline.js';
import { isSkillState, isResolverState } from '../types/pipeline.js';

export class StateMachine {
  private statesByName: Map<string, PipelineState>;
  private statesByStatus: Map<string, PipelineState>;
  private entryPhaseName: string;

  private constructor(config: PipelineConfig) {
    this.statesByName = new Map();
    this.statesByStatus = new Map();
    this.entryPhaseName = config.workflow.entry_phase;

    for (const phase of config.workflow.phases) {
      this.statesByName.set(phase.name, phase);
      this.statesByStatus.set(phase.status, phase);
    }
  }

  static fromConfig(config: PipelineConfig): StateMachine {
    return new StateMachine(config);
  }

  getEntryState(): PipelineState {
    const entry = this.statesByName.get(this.entryPhaseName);
    if (!entry) {
      throw new Error(`Entry phase "${this.entryPhaseName}" not found in pipeline config`);
    }
    return entry;
  }

  getStateByStatus(status: string): PipelineState | null {
    return this.statesByStatus.get(status) ?? null;
  }

  getStateByName(name: string): PipelineState | null {
    return this.statesByName.get(name) ?? null;
  }

  getAllStates(): PipelineState[] {
    return Array.from(this.statesByName.values());
  }

  getAllStatuses(): string[] {
    return Array.from(this.statesByStatus.keys());
  }

  getSkillStates(): SkillState[] {
    return this.getAllStates().filter(isSkillState);
  }

  getResolverStates(): ResolverState[] {
    return this.getAllStates().filter(isResolverState);
  }
}
