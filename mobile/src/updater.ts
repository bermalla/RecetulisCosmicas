import { App } from "@capacitor/app";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { API_BASE } from "./api";

type AppUpdaterPlugin = {
  install(options: { url: string; sha256: string }): Promise<{ started: boolean }>;
};

export type MobileRelease = {
  versionCode: number;
  versionName: string;
  apkUrl: string;
  sha256: string;
  notes?: string;
};

const AppUpdater = registerPlugin<AppUpdaterPlugin>("AppUpdater");

export async function checkForUpdate(): Promise<MobileRelease | null> {
  if (!Capacitor.isNativePlatform()) return null;
  const [info, response] = await Promise.all([
    App.getInfo(),
    fetch(`${API_BASE}/mobile/latest.json?check=${Date.now()}`, { cache: "no-store" }),
  ]);
  if (!response.ok) return null;
  const release = (await response.json()) as MobileRelease;
  const installedBuild = Number(info.build || 0);
  if (!Number.isInteger(release.versionCode) || release.versionCode <= installedBuild) return null;
  if (!/^https:\/\//.test(release.apkUrl) || !/^[0-9a-fA-F]{64}$/.test(release.sha256)) return null;
  return release;
}

export async function installUpdate(release: MobileRelease) {
  return AppUpdater.install({ url: release.apkUrl, sha256: release.sha256 });
}
