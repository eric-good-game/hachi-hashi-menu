import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger, PayloadTooLargeException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError, type DomainErrorKind } from '../../catalog/domain/errors';
import { currentCorrelationId } from './correlation';

interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  correlationId: string;
  errors?: string[];
}

const STATUS_BY_KIND: Record<DomainErrorKind, HttpStatus> = {
  validation: HttpStatus.BAD_REQUEST,
  not_found: HttpStatus.NOT_FOUND,
  conflict: HttpStatus.CONFLICT,
  business_rule: HttpStatus.UNPROCESSABLE_ENTITY,
};

const TITLE_BY_STATUS: Record<number, string> = {
  400: 'Solicitud inválida',
  401: 'No autenticado',
  403: 'Acceso denegado',
  404: 'No encontrado',
  409: 'Conflicto',
  422: 'Regla de negocio',
  500: 'Error interno',
  503: 'Servicio no disponible',
};

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const problem = this.toProblem(exception, request);

    if (problem.status >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl} -> ${problem.status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      problem.detail = 'Error interno del servidor';
    }

    response
      .status(problem.status)
      .type('application/problem+json')
      .send(problem);
  }

  private toProblem(exception: unknown, request: Request): ProblemDetails {
    const instance = request.originalUrl;
    const correlationId = currentCorrelationId();

    if (exception instanceof DomainError) {
      const status = STATUS_BY_KIND[exception.kind];
      return this.problem(status, exception.message, instance, correlationId);
    }

    if (exception instanceof PayloadTooLargeException) {
      return this.problem(
        HttpStatus.BAD_REQUEST,
        'La foto supera el límite de 5 MB (RN-10)',
        instance,
        correlationId,
      );
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const { detail, errors } = this.readHttpException(payload, exception.message);
      return { ...this.problem(status, detail, instance, correlationId), ...(errors ? { errors } : {}) };
    }

    return this.problem(500, 'Error interno del servidor', instance, correlationId);
  }

  private readHttpException(payload: unknown, fallback: string): { detail: string; errors?: string[] } {
    if (typeof payload === 'string') {
      return { detail: payload };
    }
    if (payload && typeof payload === 'object') {
      const message = (payload as { message?: unknown }).message;
      if (Array.isArray(message)) {
        return { detail: 'La petición no es válida', errors: message.map(String) };
      }
      if (typeof message === 'string') {
        return { detail: message };
      }
    }
    return { detail: fallback };
  }

  private problem(status: number, detail: string, instance: string, correlationId: string): ProblemDetails {
    return {
      type: 'about:blank',
      title: TITLE_BY_STATUS[status] ?? 'Error',
      status,
      detail,
      instance,
      correlationId,
    };
  }
}
