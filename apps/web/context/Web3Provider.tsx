"use client";

import type { ReactNode } from "react";
import { WorkspaceProvider } from "./WorkspaceContext";

/**
 * Rebinds the application shell to the browser-encrypted private workspace.
 */
export function Web3Provider({ children }: { children: ReactNode }) {
  return <WorkspaceProvider>{children}</WorkspaceProvider>;
}

export { WorkspaceProvider, useWorkspace } from "./WorkspaceContext";
