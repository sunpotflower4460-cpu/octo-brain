import { isNativePlatform } from "./platform";

// ネイティブの手触り(App Review 4.2: Web の包みではない体験)。web では何もしない。
// 触覚は控えめに: 送信した瞬間の軽いタップと、回答がまとまったときの完了の合図だけ。
// iOS の「システムの触覚」設定がオフなら OS 側で鳴らない。

export async function hapticTap(): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    /* 非対応端末は無視 */
  }
}

export async function hapticDone(): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    const { Haptics, NotificationType } = await import("@capacitor/haptics");
    await Haptics.notification({ type: NotificationType.Success });
  } catch {
    /* 非対応端末は無視 */
  }
}

// 共有: ネイティブは iOS 標準の共有シート、web は Web Share API。どちらも無ければ false。
export async function shareText(text: string): Promise<boolean> {
  if (isNativePlatform()) {
    try {
      const { Share } = await import("@capacitor/share");
      await Share.share({ text, dialogTitle: "OctoBrain の回答を共有" });
      return true;
    } catch {
      return true; // キャンセルも「共有シートは開いた」として扱う(コピーへ落とさない)
    }
  }
  const nav = navigator as Navigator & { share?: (d: { text: string }) => Promise<void> };
  if (!nav.share) return false;
  try {
    await nav.share({ text });
  } catch {
    /* キャンセル等 */
  }
  return true;
}
