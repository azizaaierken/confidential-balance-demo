"use client";

import { useDemoStore } from "@/store/demo-store";
import { getCopy } from "./index";

export function useCopy() {
  const locale = useDemoStore((s) => s.language);
  return getCopy(locale);
}
