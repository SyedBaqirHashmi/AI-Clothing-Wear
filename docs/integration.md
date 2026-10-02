# Store Integration Guide

How a store adds the "Try it on" button. Three options, from simplest to most automatic.

## 1. Any website (2 lines of HTML)
```html
<!-- Anywhere on the product page -->
<button data-tryon-product="firozi-lawn-3pc">Try it on</button>

<!-- Once per page, before </body> -->
<script src="https://YOUR-TRYON-HOST/tryon.js" data-store="YOUR-STORE-ID" async></script>
```
- `data-tryon-product`: the product's id in the try-on catalog. Any element works: button, link, image.
- `data-store`: selects the catalog file `catalog/<store>.json` on the try-on host.
- `data-lang` (optional): `en` or `ur`. Default: the page's `<html lang>`.

Clicking the button opens the try-on full screen. The phone's back button, the ✕ button and Escape all close it.

### JavaScript API
```js
TryOn.open({ product: 'firozi-lawn-3pc', lang: 'ur' });
TryOn.close();

// Enables the "Add to cart" button inside the try-on. Return true when added.
TryOn.onAddToCart = async ({ product, size }) => {
  // size is 'S' | 'M' | 'L' | 'XL'
  const res = await fetch('/cart/add', { method: 'POST', body: JSON.stringify({ product, size }) });
  return res.ok;
};

// Events (for analytics)
addEventListener('tryon:open', (e) => console.log('opened', e.detail.product));
addEventListener('tryon:event', (e) => console.log(e.detail.name)); // camera-started, snapshot, share, outfit-changed
addEventListener('tryon:add-to-cart', (e) => console.log(e.detail)); // { product, size }
addEventListener('tryon:close', () => {});
```

### How it works and why it's safe for the store
- `tryon.js` is 2.7 KB and does nothing until the button is tapped.
- The try-on runs in an **isolated iframe** on the try-on host. The store page never gets camera access, and the try-on can't read the store page.
- Messages between the two are checked by origin on both sides.
- The model download (~8.4 MB, once) starts only when the shopper opens the try-on, never on page load.

### Store page requirements
- HTTPS (all modern stores have it).
- No `Permissions-Policy: camera=()` header on the product page: it would forbid the camera for the iframe too. The default is fine.

## 2. Shopify
File: `integrations/shopify/snippets/tryon.liquid`
1. Online Store → Themes → **Edit code** → Snippets → **Add a new snippet** named `tryon`, paste the file.
2. In the snippet, set `tryon_host` and `tryon_store`.
3. Open the product section (e.g. `sections/main-product.liquid` in Dawn), and below the buy buttons add:
   ```liquid
   {% render 'tryon', product: product %}
   ```
4. The **product handle** must match the catalog product id.

Add-to-cart: the widget's size (S/M/L/XL) is matched to the product's variant options ("S", "Small", "M", "Medium", …). The matching available variant is added through Shopify's `/cart/add.js`. The snippet then fires `tryon:cart-updated` on `document`, so a theme can refresh its cart drawer.

A full Shopify app (theme app extension, no code editing) is planned for Phase 6.

## 3. WooCommerce
Folder: `integrations/woocommerce/tryon-for-woocommerce/`
1. Zip the folder → WordPress admin → Plugins → Add New → Upload Plugin → Activate.
2. Settings → **Virtual Try-On**: enter the try-on host and store id.
3. The **product slug** must match the catalog product id.

The plugin adds the button after the Add to cart button and loads `tryon.js` only on product pages. Add-to-cart selects the matching size in the product's attribute dropdown and submits the normal product form, so it works with any theme and with variable products. Requires WordPress 6.3+.

## Catalog format
`catalog/<store>.json` on the try-on host: a list of products. The Garment Studio exports entries in this format.
```json
[
  {
    "id": "firozi-lawn-3pc",
    "gender": "women",
    "name": { "en": "Firozi Lawn 3-Piece", "ur": "فیروزی لان تھری پیس" },
    "price": 4990,
    "swatch": "#1e9e9a",
    "layers": [
      { "id": "…", "slot": "bottom", "image": "garments/….webp", "size": [600, 900], "joints": { "…": [0.3, 0.1] }, "coverage": "ankles" },
      { "id": "…", "slot": "top", "image": "garments/….webp", "size": [700, 1000], "joints": { "…": [0.3, 0.1] }, "coverage": "knees" }
    ]
  }
]
```
In Phase 3 the catalog moves to the API and dashboard; the widget format stays the same.

## Tested
`npm run e2e:integrations` runs the Shopify snippet's and WooCommerce plugin's cart code on simulated store pages with the real `tryon.js`. `npm run e2e` includes a full embed flow on `demo-store.html`: open, start camera, add to cart, close, back button. Real Shopify and WooCommerce test stores are still to be set up (Phase 2 exit item).
