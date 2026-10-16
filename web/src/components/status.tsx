export type FormState = { error?: string; message?: string; stop?: boolean };

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
