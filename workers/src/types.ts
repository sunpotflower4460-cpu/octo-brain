// 共通型定義

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

// callModel の戻り値。原価ログ1レコード分の素材を含む
export interface ModelCallResult {
  text: string;
  inTok: number;
  outTok: number;
  ms: number;
  // usage をレスポンスから取得できず文字数概算にフォールバックした場合 true
  estimated: boolean;
}

// Workers バインディング。wrangler.toml と対応
export interface Env {
  OCTO_KV: KVNamespace;
  ENVIRONMENT?: string;
  ALLOWED_ORIGIN?: string;
  // APIキー等のシークレットは keyEnv 経由で動的参照する (Record<string, string>)
  [key: string]: unknown;
}
