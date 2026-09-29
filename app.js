import { PoseLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

// Each garment image is fitted between the shoulders (width) and down the torso (length).
//   width:  garment width as a multiple of shoulder distance
//   length: garment height as a multiple of shoulder-to-hip distance
//   top:    fraction of the image height that sits above the shoulder line (collar)
const CATALOG = [
  { name: "T-Shirt", src: "garments/tshirt.svg", width: 2.1, length: 1.35, top: 0.08 },
  { name: "Kurta",   src: "garments/kurta.svg",  width: 2.2, length: 2.1,  top: 0.05 },
  { name: "Kameez",  src: "garments/kameez.svg", width: 2.2, length: 2.2,  top: 0.05 },
];

const L_SHOULDER = 11, R_SHOULDER = 12, L_HIP = 23, R_HIP = 24;
const SMOOTHING = 0.6; // 0 = no smoothing, closer to 1 = smoother but laggier

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const shelf = document.getElementById("shelf");
const wScale = document.getElementById("wScale");
const lScale = document.getElementById("lScale");
const showPts = document.getElementById("showPts");

let landmarker = null;
let current = null;
let smoothed = null;
let lastVideoTime = -1;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function addToShelf(item) {
  item.img = await loadImage(item.src);
  const el = document.createElement("div");
  el.className = "item";
  el.innerHTML = `<img src="${item.src}" alt=""><div>${item.name}</div>`;
  el.onclick = () => select(item, el);
  shelf.appendChild(el);
  if (!current) select(item, el);
}

function select(item, el) {
  current = item;
  wScale.value = item.width;
  lScale.value = 1;
  shelf.querySelectorAll(".item").forEach((n) => n.classList.remove("active"));
  el.classList.add("active");
}

document.getElementById("upload").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  await addToShelf({ name: file.name.replace(/\.\w+$/, ""), src: URL.createObjectURL(file), width: 2.2, length: 1.4, top: 0.08 });
  shelf.lastChild.click();
};

document.getElementById("snapBtn").onclick = () => {
  const a = document.createElement("a");
  a.download = "try-on.png";
  a.href = canvas.toDataURL("image/png");
  a.click();
};

document.getElementById("startBtn").onclick = async (e) => {
  e.target.disabled = true;
  try {
    statusEl.textContent = "Loading body-tracking model…";
    const fileset = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
    landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numPoses: 1,
    });

    statusEl.textContent = "Starting camera…";
    video.srcObject = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    await video.play();
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    statusEl.textContent = "Step back until your shoulders and hips are in frame.";
    requestAnimationFrame(loop);
  } catch (err) {
    statusEl.textContent = "Error: " + err.message + " (camera needs https or localhost)";
    e.target.disabled = false;
  }
};

function lerpPoints(prev, next) {
  if (!prev) return next;
  return next.map((p, i) => ({
    x: prev[i].x * SMOOTHING + p.x * (1 - SMOOTHING),
    y: prev[i].y * SMOOTHING + p.y * (1 - SMOOTHING),
    v: p.v,
  }));
}

function loop() {
  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const res = landmarker.detectForVideo(video, performance.now());

    // Draw mirrored video so it feels like a mirror.
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    const lm = res.landmarks && res.landmarks[0];
    if (lm) {
      // Mirror x to match the flipped video; convert to pixels.
      const pts = [L_SHOULDER, R_SHOULDER, L_HIP, R_HIP].map((i) => ({
        x: (1 - lm[i].x) * canvas.width,
        y: lm[i].y * canvas.height,
        v: lm[i].visibility ?? 1,
      }));
      smoothed = lerpPoints(smoothed, pts);
      drawGarment(smoothed);
      if (showPts.checked) drawPoints(smoothed);
      statusEl.style.display = "none";
    } else {
      smoothed = null;
      statusEl.style.display = "block";
      statusEl.textContent = "No person detected — step back into the frame.";
    }
  }
  requestAnimationFrame(loop);
}

function drawGarment([ls, rs, lh, rh]) {
  if (!current || !current.img) return;
  const shoulderMid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
  const shoulderW = Math.hypot(ls.x - rs.x, ls.y - rs.y);

  // If hips are out of frame, estimate torso length from shoulder width.
  const hipsVisible = lh.v > 0.5 && rh.v > 0.5;
  const hipMid = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
  const torso = hipsVisible ? Math.hypot(hipMid.x - shoulderMid.x, hipMid.y - shoulderMid.y) : shoulderW * 1.5;

  const w = shoulderW * parseFloat(wScale.value);
  const h = torso * current.length * parseFloat(lScale.value);
  // After mirroring, the person's left shoulder is on screen-right; angle follows the shoulder line.
  const angle = Math.atan2(ls.y - rs.y, ls.x - rs.x);
  const flip = ls.x < rs.x ? -1 : 1; // user facing away / tracking swapped

  ctx.save();
  ctx.translate(shoulderMid.x, shoulderMid.y);
  ctx.rotate(flip === 1 ? angle : angle + Math.PI);
  ctx.globalAlpha = 0.95;
  ctx.drawImage(current.img, -w / 2, -h * current.top, w, h);
  ctx.restore();
}

function drawPoints(pts) {
  ctx.fillStyle = "#0f0";
  for (const p of pts) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fill();
  }
}

CATALOG.forEach(addToShelf);
