import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RabbitMQContainer, type StartedRabbitMQContainer } from '@testcontainers/rabbitmq';

export async function startPostgres(): Promise<StartedPostgreSqlContainer> {
  return new PostgreSqlContainer('postgres:16-alpine').start();
}

export async function startRabbitMq(): Promise<StartedRabbitMQContainer> {
  return new RabbitMQContainer('rabbitmq:3.13-management-alpine').start();
}

export function runMigrations(databaseUrl: string): void {
  const prisma = join(process.cwd(), 'node_modules', '.bin', 'prisma');

  try {
    execFileSync(prisma, ['migrate', 'deploy'], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    });
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? String(error);
    throw new Error(`No se pudieron aplicar las migraciones: ${stderr}`);
  }
}
