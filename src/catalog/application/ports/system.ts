export interface ClockPort {
  now(): Date;
}

export interface IdGeneratorPort {
  uuid(): string;
}

export interface CorrelationContextPort {
  correlationId(): string;
}
