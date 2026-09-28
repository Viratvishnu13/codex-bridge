export class BridgeError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'BridgeError';
    this.exitCode = exitCode;
  }
}
