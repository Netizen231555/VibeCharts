/** Error type shared by every workspace operation. */
export class WorkspaceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'WorkspaceError';
    this.code = code;
    for (const [key, value] of Object.entries(details)) {
      if (value !== undefined) this[key] = value;
    }
  }
}

export function fail(code, message, details = {}) {
  throw new WorkspaceError(code, message, details);
}

export function isWorkspaceError(error) {
  return error instanceof WorkspaceError;
}
