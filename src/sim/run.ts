import type { LabConfig, SimulationResult } from '../model';
import { simulateCache } from './cache';
import { simulateConsistency } from './consistency';
import { simulateQueue } from './queue';
import { simulateRateLimit } from './rate';
import { simulateResilience } from './resilience';

export function simulate(config: LabConfig): SimulationResult {
  switch (config.labId) {
    case 'queue':
      return simulateQueue(config);
    case 'cache':
      return simulateCache(config);
    case 'rate-limit':
      return simulateRateLimit(config);
    case 'resilience':
      return simulateResilience(config);
    case 'consistency':
      return simulateConsistency(config);
  }
}
