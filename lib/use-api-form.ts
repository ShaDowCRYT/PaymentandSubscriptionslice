import { useState } from "react";

export function useApiForm(url: string) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit(formData: FormData) {
    setPending(true);
    setError(null);
    setSuccess(false);

    try {
      const data = Object.fromEntries(formData.entries());
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const json = await res.json();

      if (!res.ok) {
        setError(json.error || "Something went wrong.");
        return false;
      }

      setSuccess(true);
      return true;
    } catch {
      setError("Network error. Please try again.");
      return false;
    } finally {
      setPending(false);
    }
  }

  return { pending, error, setError, success, submit };
}
