/**
 * Messages between the store page (loader, tryon.js) and the try-on widget (iframe).
 * Every message carries `source: 'tryon'`; each side checks the other's origin.
 */
export interface AddToCartDetail {
  product: string;
  /** Size chosen in the widget: S, M, L or XL. */
  size: string;
}

/** Widget → store page. */
export type WidgetMessage =
  | { source: 'tryon'; type: 'ready' }
  | { source: 'tryon'; type: 'close' }
  | { source: 'tryon'; type: 'add-to-cart'; id: number; detail: AddToCartDetail }
  | { source: 'tryon'; type: 'event'; name: 'camera-started' | 'snapshot' | 'share' | 'outfit-changed'; product: string };

/** Store page → widget. */
export type HostMessage = { source: 'tryon'; type: 'cart-result'; id: number; ok: boolean };

export function isTryOnMessage<T extends { source: 'tryon' }>(data: unknown): data is T {
  return typeof data === 'object' && data !== null && (data as { source?: unknown }).source === 'tryon';
}
