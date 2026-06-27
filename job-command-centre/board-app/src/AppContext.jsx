import { createContext, useContext } from "react";

// Shared app state for descendants: the SDK client, current data, a reload()
// that re-fetches everything, and a mutable Gmail-connected flag (object so
// updates are visible across components without re-rendering).
export const AppContext = createContext(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppContext.Provider");
  return ctx;
}
