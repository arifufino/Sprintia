export class UserFacingError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 409 | 503 = 400) {
    super(message);
    this.name = "UserFacingError";
  }
}

export function userFacingMessage(error: unknown, fallback: string) {
  return error instanceof UserFacingError ? error.message : fallback;
}

export function userFacingStatus(error: unknown) {
  return error instanceof UserFacingError ? error.status : 500;
}
