// SSE パーサ。fetch のストリームボディを行分割し、event/data を組み立てる。
// EventSource は POST 非対応のため fetch + ReadableStream を自前で解析する。

export interface SSEEvent {
  event: string;
  data: string;
}

export class SSEParser {
  private buffer = "";

  // チャンク文字列を投入し、完成したイベントの配列を返す (未完成分は保持)。
  push(chunk: string): SSEEvent[] {
    this.buffer += chunk;
    const events: SSEEvent[] = [];
    let sep = this.buffer.indexOf("\n\n");
    while (sep !== -1) {
      const block = this.buffer.slice(0, sep);
      this.buffer = this.buffer.slice(sep + 2);
      const evt = parseBlock(block);
      if (evt) events.push(evt);
      sep = this.buffer.indexOf("\n\n");
    }
    return events;
  }
}

// 1つのイベントブロック (空行で区切られた行群) を SSEEvent に。data 無しは null。
function parseBlock(block: string): SSEEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const rawLine of block.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith(":")) continue; // コメント行
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).replace(/^ /, ""));
    }
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}
