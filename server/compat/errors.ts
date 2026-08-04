/** Réplica de ZiteError. Códigos usados en el código: FORBIDDEN (28), NOT_FOUND (23), BAD_REQUEST (22), INTERNAL_ERROR (4). */
export type ZiteErrorCode = 'BAD_REQUEST' | 'FORBIDDEN' | 'NOT_FOUND' | 'INTERNAL_ERROR' | 'UNAUTHORIZED';

const STATUS: Record<ZiteErrorCode, number> = {
  BAD_REQUEST: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, INTERNAL_ERROR: 500,
};

export class ZiteError extends Error {
  code: ZiteErrorCode;
  status: number;
  constructor({ code, message }: { code: ZiteErrorCode; message?: string }) {
    super(message ?? code);
    this.name = 'ZiteError';
    this.code = code;
    this.status = STATUS[code] ?? 500;
  }
}
