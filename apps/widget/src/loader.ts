/**
 * tryon.js: the only script a store adds to its product pages (~3 KB).
 *
 *   <script src="https://YOUR-TRYON-HOST/tryon.js" data-store="demo" async></script>
 *   <button data-tryon-product="firozi-lawn-3pc">Try it on</button>
 *
 * Clicking any [data-tryon-product] element opens the try-on full screen in an isolated
 * iframe (the store page never gets camera access). JS API:
 *
 *   TryOn.open({ product: 'firozi-lawn-3pc', lang: 'ur' })
 *   TryOn.close()
 *   TryOn.onAddToCart = async ({ product, size }) => true   // enables the widget's cart button
 *
 * Events on window: 'tryon:open', 'tryon:close', 'tryon:add-to-cart', 'tryon:event' (CustomEvent).
 */
import { isTryOnMessage, type AddToCartDetail, type HostMessage, type WidgetMessage } from './protocol.ts';

interface OpenOptions {
  product: string;
  lang?: 'en' | 'ur';
}

interface TryOnApi {
  open(opts: OpenOptions): void;
  close(): void;
  onAddToCart: ((detail: AddToCartDetail) => Promise<boolean> | boolean) | null;
  readonly version: string;
}

declare global {
  interface Window {
    TryOn?: TryOnApi;
  }
}

(() => {
  if (window.TryOn) return; // loaded twice

  const script = (document.currentScript as HTMLScriptElement | null) ?? document.querySelector<HTMLScriptElement>('script[data-store]');
  const scriptUrl = script?.src || import.meta.url;
  const widgetUrl = new URL('./index.html', scriptUrl);
  const widgetOrigin = widgetUrl.origin;
  const store = script?.dataset.store ?? 'demo';

  let frame: HTMLIFrameElement | null = null;
  let previousOverflow = '';
  let returnFocus: Element | null = null;
  let pushedHistory = false;

  function pageLang(): 'en' | 'ur' {
    const pref = script?.dataset.lang ?? document.documentElement.lang;
    return pref?.toLowerCase().startsWith('ur') ? 'ur' : 'en';
  }

  function emit(name: string, detail?: unknown): void {
    window.dispatchEvent(new CustomEvent(`tryon:${name}`, { detail }));
  }

  function post(msg: HostMessage): void {
    frame?.contentWindow?.postMessage(msg, widgetOrigin);
  }

  function open({ product, lang }: OpenOptions): void {
    if (frame) return;
    const url = new URL(widgetUrl);
    url.searchParams.set('embed', '1');
    url.searchParams.set('store', store);
    url.searchParams.set('product', product);
    url.searchParams.set('lang', lang ?? pageLang());
    url.searchParams.set('host', location.origin);
    if (api.onAddToCart) url.searchParams.set('cart', '1');

    frame = document.createElement('iframe');
    frame.src = url.href;
    frame.title = 'Virtual try-on';
    frame.allow = `camera ${widgetOrigin}; web-share ${widgetOrigin}; clipboard-write ${widgetOrigin}`;
    frame.setAttribute(
      'style',
      'position:fixed;inset:0;width:100%;height:100%;border:0;margin:0;padding:0;z-index:2147483647;background:#0f0f10;color-scheme:dark',
    );
    returnFocus = document.activeElement;
    previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.appendChild(frame);
    frame.focus();

    // Let the phone's back button close the try-on instead of leaving the product page.
    history.pushState({ tryon: true }, '');
    pushedHistory = true;
    emit('open', { product });
  }

  function close(fromHistory = false): void {
    if (!frame) return;
    frame.remove();
    frame = null;
    document.documentElement.style.overflow = previousOverflow;
    if (returnFocus instanceof HTMLElement) returnFocus.focus();
    if (pushedHistory && !fromHistory) history.back();
    pushedHistory = false;
    emit('close');
  }

  async function handleAddToCart(id: number, detail: AddToCartDetail): Promise<void> {
    emit('add-to-cart', detail);
    let ok = false;
    try {
      ok = api.onAddToCart ? Boolean(await api.onAddToCart(detail)) : false;
    } catch (err) {
      console.error('[tryon] add to cart failed', err);
    }
    post({ source: 'tryon', type: 'cart-result', id, ok });
  }

  window.addEventListener('message', (ev: MessageEvent) => {
    if (ev.origin !== widgetOrigin || !frame || ev.source !== frame.contentWindow) return;
    if (!isTryOnMessage<WidgetMessage>(ev.data)) return;
    const msg = ev.data;
    if (msg.type === 'close') close();
    else if (msg.type === 'add-to-cart') void handleAddToCart(msg.id, msg.detail);
    else if (msg.type === 'event') emit('event', { name: msg.name, product: msg.product });
  });

  window.addEventListener('popstate', () => {
    if (frame) {
      pushedHistory = false;
      close(true);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && frame) close();
  });

  document.addEventListener('click', (e) => {
    const el = (e.target as Element | null)?.closest<HTMLElement>('[data-tryon-product]');
    if (!el) return;
    e.preventDefault();
    open({ product: el.dataset.tryonProduct!, lang: (el.dataset.tryonLang as 'en' | 'ur' | undefined) ?? undefined });
  });

  const api: TryOnApi = {
    open,
    close: () => close(),
    onAddToCart: null,
    version: '0.2.0',
  };
  window.TryOn = api;
})();
