/** `id`: what the action just created, when the form needs it (for example to upload attachments to a new note). */
export type FormState = { error?: string; message?: string; stop?: boolean; id?: string };

export function Status({ state }: { state: FormState }) {
  if (state.error)
    return (
      <p className={state.stop ? "error stopbox" : "error"} role="alert">
        {state.error}
      </p>
    );
  if (state.message)
    return (
      <p className="notice" role="status">
        {state.message}
      </p>
    );
  return null;
}
