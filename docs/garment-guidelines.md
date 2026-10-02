# Garment Photo Guidelines and Studio Workflow

How to turn a brand's product photo into a try-on garment with the **Garment Studio** (`npm run studio`, then open http://localhost:5174).

## What photo works best
| Good | Avoid |
|---|---|
| Model standing straight, facing the camera | Side or 3/4 views, walking poses |
| Arms slightly away from the body (A-pose) | Arms crossed, hands on hips, holding the dupatta |
| Full garment visible (shoulders to hem; ankles for shalwar) | Cropped at the knees when the shalwar matters |
| Plain, light background | Busy backgrounds, other people |
| Even, soft light | Strong shadows across the garment |
| Long side ≥ 1500 px | Small, heavily compressed images |
| Hair behind the shoulders | Long hair covering the neckline |

**Flat-lay or ghost-mannequin photos** (garment alone on a plain background) also work. Choose "Plain background" in the Studio and place the joints by hand.

**Unstitched lawn:** use a photo of the stitched sample or a model shot. A fabric swatch can't be tried on.

## Studio workflow
1. **Photo:** drop the image on the canvas or choose it.
   - *Worn by a model:* the AI finds the clothes (removing face, hair, skin and background) and the model's joints.
   - *Plain background:* the background is removed by colour; joints start from a template.
   - *Fill gaps* (on by default) closes small holes where hair or fingers covered the fabric, and fills them with nearby fabric colour.
2. **Check the joints:** yellow dots are the wearer's right side (image left), teal dots the left side. Drag any dot that is off. Shoulders and hips matter most.
3. **Layer:**
   - A **kurta or kameez** alone: Type = Top, Keep = Whole cut-out.
   - A **3-piece suit photo**: add two layers from the same photo.
     - Top: Keep = *Above the line*, drag the dashed line to the kameez hem.
     - Bottom: Type = Bottom, Keep = *Below the line* (the visible shalwar/trouser).
   - **Dupatta:** best from its own flat-lay photo, Type = Drape, opacity 0.7–0.9 for chiffon or net.
4. **Product:** fill in id (must match the store's product handle or slug), section, names, price → **Add layer to product** for each layer.
5. **Preview try-on:** check it on the same photo, on another photo ("Other photo…"), or live on the webcam. Raise your arms: sleeves should follow; the kameez should hang.
6. **Download:** saves each layer image (WebP) and the product's catalog JSON. Put the images in the widget's `garments/` folder and add the JSON entry to `catalog/<store>.json`. Phase 3 replaces this step with one-click publishing.

## What real catalogue photos taught us (tested on ~300 Pakistani e-commerce photos)
- **Unstitched fabric shots are common**: many listings show only fabric. These have no person and are skipped automatically ("Skipped: no person in the photo").
- **Hands resting on the kameez** leave holes. They're filled with the surrounding fabric colour (skin is detected separately and never used). Prints can't be recreated inside those patches yet, so the patches look like soft solid colour.
- **Dupattas draped over the kameez** stay part of the main layer. That looks right on the shopper, since it's how the outfit was styled.
- **Automatic kameez/shalwar splitting is deliberately conservative.** It only splits when the clothing clearly narrows below the hem *and* another signal agrees. Long kurtas with side slits, lehengas and hanging dupattas fooled looser rules. When unsure, the whole outfit stays one layer. For suits that need a separate shalwar, set the split in the Studio or with `splitAt` in `product.json`.
- **Stray fragments** (other colourways shown beside the model, background props) are removed automatically.

## Known limits (v1)
- One photo gives the **front** of the garment only.
- The part of a shalwar hidden under the kameez isn't in the photo. That's fine for try-on, because the kameez covers it there too.
- A dupatta draped over the kameez in the photo can't be separated automatically. Shoot it separately.
- The segmentation model sees the image at 256×256 before edge refinement, so fine details (lace edges, tassels) may be softened.
