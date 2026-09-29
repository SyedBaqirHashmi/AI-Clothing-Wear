# AI Clothing Wear — Virtual Try-On (prototype)

Browser-based virtual try-on for Pakistani clothing e-commerce stores.
Open the webcam (or phone camera from ~1.5–2 m), pick a garment, and see it overlaid on your body in real time.

## Run
Camera access needs https or localhost:

```
python3 -m http.server 8000
# open http://localhost:8000
```

## How it works
- MediaPipe Pose Landmarker (in-browser, loaded from CDN) tracks shoulders and hips.
- The selected garment image is scaled/rotated between those points and drawn on a canvas.
- Upload any transparent PNG to try your own product. Snapshot saves the result.

Sample garments in `garments/` are placeholders.
