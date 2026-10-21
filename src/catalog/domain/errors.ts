export type DomainErrorKind = 'validation' | 'not_found' | 'conflict' | 'business_rule';

export class DomainError extends Error {
  constructor(
    readonly kind: DomainErrorKind,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, code = 'VALIDATION_ERROR') {
    super('validation', message, code);
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string, code = 'NOT_FOUND') {
    super('not_found', message, code);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, code = 'CONFLICT') {
    super('conflict', message, code);
  }
}

export class BusinessRuleError extends DomainError {
  constructor(message: string, code = 'BUSINESS_RULE') {
    super('business_rule', message, code);
  }
}
