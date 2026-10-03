import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { OperationalAlertsService } from './operational-alerts.service.js';

const EVALUATION_INTERVAL_MS = 60_000;

/**
 * Periodically reconciles operational alerts. It only reads heartbeats and
 * telemetry and writes alert state; nothing in distribution or enforcement
 * depends on it, so a failure here only delays alerts.
 */
@Injectable()
export class OperationalAlertEvaluator
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(OperationalAlertEvaluator.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | null = null;
  private stopping = false;

  constructor(private readonly alerts: OperationalAlertsService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => this.tick(), EVALUATION_INTERVAL_MS);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    clearInterval(this.timer);
    await this.running;
  }

  private tick(): void {
    if (this.running || this.stopping) return;
    this.running = this.evaluate().finally(() => {
      this.running = null;
    });
  }

  private async evaluate(): Promise<void> {
    try {
      const tenants = await this.alerts.tenantsToEvaluate();
      for (const tenant of tenants) {
        if (this.stopping) return;
        try {
          await this.alerts.evaluateTenant(
            tenant.organizationId,
            tenant.tenantId,
          );
        } catch (error) {
          this.logger.warn(
            `Alert evaluation for tenant ${tenant.tenantId.toHexString()} failed: ${error instanceof Error ? error.name : 'unknown'}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Alert evaluation failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
    }
  }
}
