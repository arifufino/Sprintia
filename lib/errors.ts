export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

export function userFacingMessage(error: unknown, fallback: string) {
  return error instanceof UserFacingError ? error.message : fallback;
}

export function userFacingStatus(error: unknown) {
  return error instanceof UserFacingError ? 400 : 500;
}
