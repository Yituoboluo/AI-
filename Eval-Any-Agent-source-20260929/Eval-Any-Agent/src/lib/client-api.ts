"use client";

import { toast } from "sonner";

let unauthorizedToastShown = false;

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => null);

  if (res.status === 401) {
    if (!unauthorizedToastShown) {
      unauthorizedToastShown = true;
      toast.error(json?.message || "登录已失效，请重新登录");
      window.setTimeout(() => {
        window.location.assign("/login");
      }, 800);
    }
    throw new Error(json?.message || "未登录");
  }

  if (!res.ok || !json?.ok) throw new Error(json?.message || "请求失败");
  return json.data as T;
}
