import * as OpenCC from "opencc-js";
import { zhHans } from "./zh-Hans";

const toTraditional = OpenCC.Converter({ from: "cn", to: "tw" });

export const zhHant = Object.fromEntries(
  Object.entries(zhHans).map(([key, value]) => [key, toTraditional(value)]),
) as typeof zhHans;

Object.assign(zhHant, {
  settings: "設定",
  settingsDescription: "設定目錄、下載器、AI 模型、RSS 來源和預設語言。",
  settingsLoadError: "無法載入設定。請確認資料庫已完成遷移並正在執行。",
  settingsSaveError: "儲存設定失敗。",
  directorySettings: "目錄設定",
  aria2Settings: "aria2 下載器",
  aiSettings: "AI 模型",
  metadataProviderSettings: "元資料來源",
  metadataProviderSettingsDescription: "TMDB/OMDB 用於電影和電視劇匹配；TheTVDB/AniDB 用於動畫目錄、季集與絕對編號映射。",
  generalSettings: "一般設定",
  queueStatus: "佇列狀態",
  queueStatusReview: "需確認",
  queueStatusEmpty: "僅後續",
  futureOnly: "僅後續",
  futureOnlyPolicy: "依所選版本訂閱未來更新",
  futureOnlySubscribe: "訂閱後續",
  noVersionsYet: "暫時沒有可下載版本，訂閱後會匹配後續 RSS 更新。",
  animeLibrary: "動漫庫",
  animeLibraryDescription: "已歸檔動畫會出現在這裡，可直接播放或準備保真 HLS。",
  filesDescription: "唯讀瀏覽已設定的資料、下載、媒體庫、元資料和轉碼目錄。",
  seasonCatalog: "季集目錄",
  seasonCatalogDescription: "人工確認每季集數和絕對編號範圍，缺集與候選匹配會優先使用這裡的目錄。",
  seasonCatalogEpisodeCount: "集數",
  seasonCatalogAbsoluteStart: "絕對起始",
  seasonCatalogAbsoluteEnd: "絕對結束",
  seasonCatalogSourceUrl: "來源 URL",
  addSeasonCatalog: "新增季",
});
