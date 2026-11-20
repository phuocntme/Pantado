/** Typed config error: names the file and every failing path so the message is actionable. */
export class ConfigError extends Error {
  override readonly name = "ConfigError";
  constructor(
    readonly file: string,
    readonly issues: readonly string[],
  ) {
    super(`Invalid config ${file}:\n  - ${issues.join("\n  - ")}`);
  }
}
