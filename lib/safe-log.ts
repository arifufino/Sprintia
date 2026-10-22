// Never serialize an exception: messages, stacks, causes and driver metadata
// can contain credentials or user content. Only fixed categories are recorded.
type FailureEvent = "bootstrap.failed" | "mutation.failed" | "export.failed" | "page.failed";
export function failureRecord(event: FailureEvent, error?: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  const category = code === 11000 ? "duplicate" : code === 121 ? "validation" : code === 20 ? "transactions" : "unexpected";
  return { event, category, reference: crypto.randomUUID() };
}
export function logFailure(event: FailureEvent, error?: unknown) {
  const record = failureRecord(event, error);
  console.error(JSON.stringify(record));
  return record.reference;
}
