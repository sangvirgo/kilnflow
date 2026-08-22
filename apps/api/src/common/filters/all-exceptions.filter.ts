import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { AppError } from '../errors';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = 'Internal server error';
    let message = 'Unexpected server error';
    let detail: unknown;
    if (exception instanceof AppError) {
      statusCode = exception.statusCode;
      error = exception.errorCode;
      message = exception.message;
      detail = exception.detail;
    } else if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();
      error = typeof body === 'object' && body !== null ? String((body as any).error || exception.message) : exception.message;
      message = typeof body === 'object' && body !== null ? String((body as any).message ?? exception.message) : exception.message;
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error('Unhandled: ' + exception.stack);
    }
    res.status(statusCode).json({ statusCode, error, message, detail });
  }
}