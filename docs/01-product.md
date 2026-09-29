# 1. Product Definition

## 1.1 One-line pitch
A "Try it on" button for Pakistani online clothing stores: the shopper opens their phone or laptop camera, picks an outfit, and sees it on their own body live, then can take a realistic photo to share on WhatsApp before ordering.

## 1.2 Problem
- Pakistani shoppers buy clothes online without knowing how the cut, colour and length look on *them*.
- Most orders are **Cash on Delivery (COD)**. When the customer doesn't like the item they refuse it at the door, and the store pays courier fees both ways. Refusals and returns are a major cost for local brands.
- Product photos use professional models, so shoppers can't judge fit on their own body type.

## 1.3 Users

| User | What they want | Where they use it |
|---|---|---|
| **Shopper** (primary) | See themselves in the outfit quickly, share with family, decide confidently | Mostly Android phones, some laptops |
| **Store owner / manager** | Fewer COD refusals, higher conversion, easy product setup | Laptop, Shopify/WooCommerce admin |
| **Store content team** | Upload product images once and have them work in try-on | Laptop |

## 1.4 Product surfaces
1. **Try-On Widget** (shopper-facing): opens from the product page, runs in the browser with no app install.
2. **Live Mode**: real-time camera overlay at 720p / 30 fps.
3. **Photo Mode**: an AI-generated realistic photo from one captured frame (5–20 s).
4. **Store Dashboard**: upload garments, automatic preparation, preview, analytics, billing.
5. **Platform integrations**: Shopify app, WooCommerce plugin, universal JS embed.

## 1.5 Pakistan-specific constraints (must-haves)

| Constraint | What it means for the product |
|---|---|
| **Traditional, long garments** (kurta, kameez, shalwar, trouser, dupatta, abaya, waistcoat) | Tracking must cover the full body, down to knees and ankles, not just the torso. Garments must bend with the arms and legs. |
| **3-piece suits** (kameez + shalwar/trouser + dupatta) | One product can be **several layers** worn at once, drawn in the correct order. |
| **Unstitched lawn / fabric sales** | The store must supply a *stitched* reference image (made-up sample or model shot). The dashboard should flag unstitched fabric photos. |
| **Low and mid-range Android phones** (Infinix, Tecno, Redmi, Samsung A-series, Vivo, Oppo) | On-device performance budget, adaptive quality, no heavy 3D. |
| **Expensive or unstable mobile data** | Small first download, aggressive caching, compressed garment images, works on 4G. |
| **Small rooms, hard to stand 2 m away** | "Upper-body mode" (head to hips) for tops; rear camera option; phone-on-shelf + countdown timer. |
| **Poor indoor lighting** (tube lights, backlit windows) | Lighting check with guidance ("face the light"); the overlay should adapt to scene brightness. |
| **Privacy and modesty, especially for women** | All live processing on the device. No video leaves the phone. Photo Mode upload only with explicit consent, auto-deleted. Clear notice in Urdu and English. |
| **Language** | English + Urdu (right-to-left). Roman Urdu labels are optional. |
| **Sharing culture** | One-tap share to WhatsApp (Web Share API) with the product link. |
| **Local payments for store billing** | JazzCash, Easypaisa, local card gateways (e.g. Safepay, PayFast). Stripe does not serve Pakistani merchants directly. |
| **Platforms stores use** | Shopify and WooCommerce first; Daraz does not allow third-party widgets. |

## 1.6 Quality bar (what "perfect product" means, measurably)
- **Video:** camera preview is **≥ 720p at ≥ 30 fps** on target devices (see requirements, section 2.3).
- **Tracking:** the garment stays attached to the body with no visible jitter while standing, and follows arm and leg movement.
- **Latency:** the garment lags body movement by less than about 100 ms (below that, most people can't notice it).
- **Fit look:** shoulders, neckline, sleeves and hem land where a real garment would, within about 5% of body height.
- **Photo Mode:** output a shopper would believe is a real photo (folds, lighting, body shape preserved).
- **Honesty:** Live Mode is a *preview*, not a photo. The UI never claims more accuracy than it has.

## 1.7 Success metrics (measured per store)
- Try-on usage rate: % of product-page visitors who open try-on
- Conversion lift: users who try on vs. those who don't
- COD refusal / return rate change after adoption
- Share rate (WhatsApp shares per session)
- Performance: median fps and first-load time per device model

## 1.8 Business model (assumption; to validate with stores)
- Monthly subscription tiers by number of try-on sessions, billed in PKR.
- Live Mode sessions are cheap to serve (runs on the shopper's phone). Photo Mode generations cost GPU money, so they are counted and limited per plan.
- Free pilot for 2–3 brands in exchange for data on conversion and COD refusals.

## 1.9 Out of scope for v1
- Full 3D body scanning or cloth simulation
- Exact size prediction (measurements) — planned for v2
- Native iOS/Android apps (web first)
- Daraz integration
