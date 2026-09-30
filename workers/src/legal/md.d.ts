// wrangler の [[rules]] type="Text" で .md を文字列として取り込む(vitest は vitest.config の loader)。
declare module "*.md" {
  const content: string;
  export default content;
}
