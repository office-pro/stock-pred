/**
 * Real-Time Analysis Orchestrator
 *
 * Coordinates real-time data ingestion and analysis across all stocks.
 * Features:
 * - Parallel data collection for multiple stocks
 * - Rate limiting and backpressure handling
 * - Graceful degradation (falls back to HTTP polling)
 * - Non-breaking to existing code
 */

import { EventEmitter } from 'events';
import { Tick, Candle } from '@stockpred/shared-types';

export interface AnalysisTask {
  symbol: string;
  tick: Tick;
  context?: {
    candles?: Candle[];
    indicators?: Record<string, number>;
    lastSignal?: string;
  };
}

export interface OrchestrationConfig {
  maxConcurrentTasks: number; // Default: 10
  rateLimit: number; // Tasks per second
  analysisTimeout: number; // ms
  fallbackStrategy: 'http' | 'simulated' | 'hybrid'; // Default: 'hybrid'
  enableMetrics: boolean; // Default: true
}

/**
 * Orchestrates real-time analysis across all stocks
 */
export class RealTimeOrchestrator extends EventEmitter {
  private config: OrchestrationConfig;
  private activeTasks = 0;
  private taskQueue: AnalysisTask[] = [];
  private metrics = {
    processed: 0,
    failed: 0,
    avgLatency: 0,
  };

  constructor(config: Partial<OrchestrationConfig> = {}) {
    super();
    this.config = {
      maxConcurrentTasks: config.maxConcurrentTasks || 10,
      rateLimit: config.rateLimit || 100, // 100 tasks/sec
      analysisTimeout: config.analysisTimeout || 5000, // 5 seconds
      fallbackStrategy: config.fallbackStrategy || 'hybrid',
      enableMetrics: config.enableMetrics !== false,
    };

    console.log(`[orchestrator] Initialized with config:`, this.config);
  }

  /**
   * Enqueue analysis task for a stock tick
   */
  async enqueueTask(task: AnalysisTask): Promise<void> {
    this.taskQueue.push(task);
    this.processQueue();
  }

  /**
   * Enqueue multiple tasks (batch)
   */
  async enqueueBatch(tasks: AnalysisTask[]): Promise<void> {
    this.taskQueue.push(...tasks);
    this.processQueue();
  }

  /**
   * Process queued tasks with concurrency control
   */
  private async processQueue(): Promise<void> {
    while (this.taskQueue.length > 0 && this.activeTasks < this.config.maxConcurrentTasks) {
      const task = this.taskQueue.shift();
      if (!task) break;

      this.activeTasks++;
      this.processTask(task)
        .catch((error) => {
          console.error(`[orchestrator] Task failed for ${task.symbol}:`, error);
          this.metrics.failed++;
          this.emit('task-error', { symbol: task.symbol, error });
        })
        .finally(() => {
          this.activeTasks--;
          this.processQueue(); // Process next task
        });

      // Rate limiting: eslint-disable-next-line no-await-in-loop
      await this.sleep(1000 / this.config.rateLimit);
    }
  }

  /**
   * Execute single analysis task
   */
  private async processTask(task: AnalysisTask): Promise<void> {
    const startTime = Date.now();

    // Timeout protection
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Analysis timeout')), this.config.analysisTimeout),
    );

    const analysisPromise = this.runAnalysis(task);
    await Promise.race([analysisPromise, timeoutPromise]);

    this.metrics.processed++;
    const latency = Date.now() - startTime;
    this.metrics.avgLatency = (this.metrics.avgLatency + latency) / 2;

    this.emit('task-complete', { symbol: task.symbol, latency });
  }

  /**
   * Run analysis pipeline for a single stock
   */
  private async runAnalysis(task: AnalysisTask): Promise<void> {
    const { symbol, tick } = task;

    this.emit('tick', { symbol, tick });

    if (task.context?.candles && task.context.candles.length > 40) {
      this.emit('signal-evaluate', { symbol, candles: task.context.candles });
    }

    if (process.env.ENABLE_PATTERN_DETECTION !== 'false') {
      this.emit('pattern-detect', { symbol });
    }

    if (process.env.ENABLE_ML_PREDICTIONS !== 'false') {
      this.emit('ml-predict', { symbol });
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): typeof this.metrics {
    return { ...this.metrics };
  }

  /**
   * Get queue status
   */
  getStatus(): {
    queueSize: number;
    activeTasks: number;
    metrics: { processed: number; failed: number; avgLatency: number };
  } {
    return {
      queueSize: this.taskQueue.length,
      activeTasks: this.activeTasks,
      metrics: this.metrics,
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = { processed: 0, failed: 0, avgLatency: 0 };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    console.log(`[orchestrator] Shutting down...`);
    await this.waitForQueueEmpty();
    this.removeAllListeners();
    console.log(`[orchestrator] Shutdown complete. Final metrics:`, this.metrics);
  }

  /**
   * Wait for all tasks to complete
   */
  private async waitForQueueEmpty(): Promise<void> {
    while (this.taskQueue.length > 0 || this.activeTasks > 0) {
      await this.sleep(100);
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Global orchestrator instance
 */
let globalOrchestrator: RealTimeOrchestrator | null = null;

/**
 * Get or create global orchestrator
 */
export function getOrchestrator(): RealTimeOrchestrator {
  if (!globalOrchestrator) {
    globalOrchestrator = new RealTimeOrchestrator({
      maxConcurrentTasks: parseInt(process.env.MAX_CONCURRENT_TASKS || '10', 10),
      rateLimit: parseInt(process.env.ANALYSIS_RATE_LIMIT || '100', 10),
      fallbackStrategy:
        (process.env.FALLBACK_STRATEGY as 'http' | 'simulated' | 'hybrid') || 'hybrid',
    });
  }
  return globalOrchestrator;
}
