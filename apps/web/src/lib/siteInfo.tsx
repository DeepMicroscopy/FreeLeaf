import { api } from "@freeleaf/shared";
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

interface SiteInfoContextValue {
  /** Shown next to the leaf icon in place of the literal "FreeLeaf" text
   * (Plan.md §9 Phase 11, admin-configurable) — defaults to "FreeLeaf"
   * while the public `/api/site-info` fetch is still in flight, so nothing
   * ever renders blank waiting on it. */
  siteName: string;
}

const SiteInfoContext = createContext<SiteInfoContextValue>({ siteName: "FreeLeaf" });

export function SiteInfoProvider({ children }: { children: ReactNode }) {
  const [siteName, setSiteName] = useState("FreeLeaf");

  useEffect(() => {
    api.GET("/api/site-info").then(({ data }) => {
      if (data) setSiteName(data.site_name);
    });
  }, []);

  return <SiteInfoContext.Provider value={{ siteName }}>{children}</SiteInfoContext.Provider>;
}

export function useSiteInfo(): SiteInfoContextValue {
  return useContext(SiteInfoContext);
}
