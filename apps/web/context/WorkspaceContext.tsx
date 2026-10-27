"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { RelayClient } from "@/lib/requests/relay";
import { relayConfiguration } from "@/lib/requests/config";
import { getWorkspaceRecoveryStatus } from "@/lib/workflow/recovery";
import { workspaceSupport } from "@/lib/private-workspace/storage";
import type { Network } from "@/lib/bills/types";

export interface WorkspaceRecoveryInfo {
  lastExportAt: string | null;
  uncoveredRecords: number;
  restoredAt: string | null;
  requiresRemoteRefresh: boolean;
}

export interface WorkspaceContextValue {
  network: Network;
  setNetwork: (net: Network) => void;
  relay: RelayClient;
  relayConnection: RelayConnection;
  refreshRelay: () => void;
  appUrl: string;
  status: WorkspaceRecoveryInfo | null;
  refreshStatus: () => Promise<void>;
  isSupported: boolean | null;
}

export interface RelayConnection {
  status: "unconfigured" | "checking" | "connected" | "offline";
  checkedAt: string | null;
  error: string | null;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const network: Network = "testnet";
  const [status, setStatus] = useState<WorkspaceRecoveryInfo | null>(null);
  const [isSupported, setIsSupported] = useState<boolean | null>(null);

  const setNetwork = (net: Network) => {
    if (net !== "testnet") throw new Error("Splyt supports Zcash testnet only.");
  };

  const relayUrl = process.env.NEXT_PUBLIC_RELAY_URL;
  const configuration = useMemo(() => relayConfiguration(relayUrl), [relayUrl]);
  const configuredNetwork = process.env.NEXT_PUBLIC_ZCASH_NETWORK;
  const configurationError = configuredNetwork && configuredNetwork !== "testnet"
    ? "Splyt is testnet-only. Set NEXT_PUBLIC_ZCASH_NETWORK to testnet and rebuild the web app."
    : configuration.error;
  const relay = useMemo(() => new RelayClient({ baseUrl: configurationError ? undefined : configuration.baseUrl ?? undefined }), [configuration.baseUrl, configurationError]);
  const [relayConnection, setRelayConnection] = useState<RelayConnection>(() => ({
    status: configurationError ? "unconfigured" : "checking",
    checkedAt: null,
    error: configurationError,
  }));
  const [relayCheck, setRelayCheck] = useState(0);

  const refreshRelay = () => {
    setRelayConnection((previous) => ({ ...previous, status: configurationError ? "unconfigured" : "checking", error: configurationError }));
    setRelayCheck((previous) => previous + 1);
  };

  useEffect(() => {
    if (configurationError) return;
    let cancelled = false;
    let running = false;
    let generation = 0;
    const check = async () => {
      if (document.visibilityState === "hidden" || running) return;
      running = true;
      const current = ++generation;
      try {
        await relay.health();
        if (!cancelled && current === generation) {
          setRelayConnection({ status: "connected", checkedAt: new Date().toISOString(), error: null });
        }
      } catch (error) {
        if (!cancelled && current === generation) {
          setRelayConnection((previous) => ({
            status: "offline",
            checkedAt: previous.checkedAt,
            error: error instanceof Error ? error.message : "The relay is unavailable. Your local records are unchanged.",
          }));
        }
      } finally {
        running = false;
      }
    };
    const offline = () => {
      generation += 1;
      setRelayConnection((previous) => ({ ...previous, status: "offline", error: "This browser is offline. Your local records are unchanged." }));
    };
    const recheck = () => { void check(); };
    void check();
    const interval = window.setInterval(recheck, 30_000);
    window.addEventListener("offline", offline);
    window.addEventListener("online", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [relay, relayCheck, configurationError]);

  const appUrl = useMemo(() => {
    if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
    if (typeof window !== "undefined") return window.location.origin;
    return "";
  }, []);

  const refreshStatus = async () => {
    try {
      const supported = await workspaceSupport();
      setIsSupported(supported);
      if (supported) {
        const s = await getWorkspaceRecoveryStatus();
        setStatus(s);
      }
    } catch {
      setIsSupported(false);
      setStatus(null);
    }
  };

  useEffect(() => {
    void refreshStatus();
  }, []);

  return (
    <WorkspaceContext.Provider
      value={{
        network,
        setNetwork,
        relay,
        relayConnection,
        refreshRelay,
        appUrl,
        status,
        refreshStatus,
        isSupported,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return ctx;
}
