# datasets/: real product photos for testing

Everything in this folder except this README is **ignored by git** on the code branches,
so brand photos never end up in the code, a build, or a public page.

## Folder layout
```
datasets/
  <store>/                 e.g. khaadi, sana-safinaz, nishat, j-junaid-jamshed
    <product-id>/          lowercase-with-dashes; must match the store's product handle/slug
      photo.jpg            the garment worn by a model (required; .jpg .png .webp)
      dupatta.jpg          optional: the dupatta alone on a plain background
      product.json         optional details (see below)
```

Example:
```
datasets/
  khaadi/
    firozi-lawn-3pc/
      photo.jpg
      dupatta.jpg
      product.json
  j-junaid-jamshed/
    white-cotton-kurta/
      photo.jpg
```

## product.json (all fields optional)
```json
{
  "name": { "en": "Firozi Lawn 3-Piece", "ur": "فیروزی لان تھری پیس" },
  "price": 4990,
  "gender": "women",
  "type": "suit",
  "kind": "model",
  "splitAt": 0.62
}
```
- `type`: `suit` (kameez + shalwar/trouser from one photo), `top` (kurta or kameez only), `bottom`. Default: automatic. If a kameez hem is detected, the product is treated as a suit.
- `kind`: `model` (worn by a person, the default) or `plain` (flat-lay on a plain background).
- `splitAt`: kameez hem position as a fraction of the photo height (0 = top, 1 = bottom), if automatic detection gets it wrong.

## Which photos work
See `docs/garment-guidelines.md`. In short: model facing the camera, standing straight, arms slightly away from the body, the full outfit visible, a plain background, and at least 1500 px on the long side.

## Get photos automatically (open licences)
```bash
npm run datasets -- --openverse        # CC-licensed photos, no key
npm run datasets -- --pexels           # needs PEXELS_API_KEY
npm run datasets -- --roboflow         # labelled kameez/shalwar/dupatta, needs ROBOFLOW_API_KEY
```
Each photo folder also gets `source.json` (licence, author, link) and, for labelled datasets, `labels.json`, which the import uses to measure hem-detection accuracy. See `docs/testing-guide.md`.

## Run the import
```bash
npm run import                 # processes every product folder
open datasets/report.html      # review: cut-out, joints, split line, layers, warnings
npm run dev                    # then http://localhost:5173/?store=khaadi
```
Fix any product marked "check" in the Garment Studio (`npm run studio`), or adjust its `product.json` and run the import again.

## Sharing photos with Claude (cloud sessions)
Photos pasted into chat don't reach the cloud machine as files, and most image hosts are blocked there. Use the repository's **`datasets` branch** instead. It only holds photos and is never merged into the code.
1. Make the repository **private** first (Settings → General → Danger Zone → Change visibility).
2. On github.com, switch to the `datasets` branch → **Add file → Upload files** → drag in your folders (keep the `datasets/<store>/<product>/` layout) → Commit.
3. Tell Claude. It will pull the branch, run the import, and report back.

**Permissions:** use brand photos for internal testing only. Before showing them outside the team or training a model that ships, get the brand's permission (see `docs/07-target-brands.md`).
