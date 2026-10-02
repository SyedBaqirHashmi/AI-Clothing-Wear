# 7. Target Brands and Data Plan

## 7.1 Target customers
The product is built for Pakistan's leading clothing brands first, then mid-size and small stores.

| Tier | Brands (examples) | Why |
|---|---|---|
| Top brands | Nishat Linen, J. (Junaid Jamshed), Sana Safinaz, Khaadi, Gul Ahmed, Sapphire, Alkaram Studio, Maria B, Limelight, Bonanza Satrangi | Large online sales, high COD-return cost, budget for new tech, strong brand image to protect |
| Mid-size | Regional and online-first labels | Faster decisions; good pilot partners |
| Small stores | Instagram/Facebook/Shopify sellers | Volume later via a self-serve plan |

Quality bar consequence: top brands care about **how their garments look**. Prints, embroidery and colours must be reproduced faithfully, so garment preparation (Phase 2) must use **their own high-resolution product images**, not redrawn artwork.

## 7.2 Store platforms (evidence so far)
| Brand | Platform | Source / status |
|---|---|---|
| Khaadi | Shopify | Secondary source ([EComposer case studies](https://ecomposer.io/blogs/case-studies/shopify-stores-in-pakistan)), to verify |
| Sana Safinaz | Shopify | Same source, to verify |
| Others | Unknown | To verify (the development environment's network blocks the brand sites) |

Verification method: open `https://<brand-site>/products.json` (works on Shopify stores) or check with a technology-lookup tool. **Current evidence supports D-4 = Shopify first.**

## 7.3 Data we can use, and how
| Data | Use | Rule |
|---|---|---|
| Public facts: platform, categories (lawn, pret, unstitched, kurta…), size charts (measurements) | Category templates, size mapping (S/M/L/XL → body proportions), integration design | OK to collect and summarise |
| Product photos and catalogues | Garment layers for try-on | **Only with the brand's written permission** (pilot agreement). Their images are copyrighted; scraping and reusing them would break their terms and damage the relationship with our future customers |
| Shopper images / video | Nothing | Never collected in Live Mode (privacy requirement N-20) |

## 7.4 What brand data improves accuracy
1. **Size charts** (chest, waist, hip, length per size): make the S/M/L/XL fit control match the real garment.
2. **Garment length and cut per product** (e.g. "kameez length 44 in", straight/A-line): sets the hem anchor (`hemT`) per product instead of a category default.
3. **Model photos with known model height**: calibrate sleeve and hem positions.
4. **Flat-lay or ghost-mannequin photos**: the best input for clean garment cut-outs.

Phase 0 action: ask each pilot brand for 20 products with the four items above.

## 7.5 Internal test set (before brand agreements)
For internal testing and model evaluation only, product images collected by hand from brand websites go in `datasets/` at the repo root. That folder is **git-ignored**: these images never enter the repository, a deployed build, or anything shown outside the team. Before using them to train a model that ships, or in any demo for a third party, get the brand's permission.
