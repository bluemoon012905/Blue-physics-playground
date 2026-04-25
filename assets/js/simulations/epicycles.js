const canvas = document.getElementById("epicycle-canvas");
const context = canvas.getContext("2d");

const controls = {
  segments: document.getElementById("segments"),
  speed: document.getElementById("speed"),
  trail: document.getElementById("trail"),
  segmentsValue: document.getElementById("segments-value"),
  speedValue: document.getElementById("speed-value"),
  trailValue: document.getElementById("trail-value"),
  randomize: document.getElementById("randomize"),
  pause: document.getElementById("pause"),
  clearTrail: document.getElementById("clear-trail"),
};

const state = {
  time: 0,
  paused: false,
  trail: [],
  segments: [],
  pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
  width: 0,
  height: 0,
};

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function buildSegments(count) {
  const baseRadius = Math.min(state.width, state.height) * 0.18;

  return Array.from({ length: count }, (_, index) => {
    const radiusScale = Math.pow(0.68, index);
    const radius = baseRadius * radiusScale;
    const direction = index % 2 === 0 ? 1 : -1;
    const harmonic = index + 1;

    return {
      radius,
      speed: direction * harmonic * randomBetween(0.7, 1.3),
      phase: randomBetween(0, Math.PI * 2),
    };
  });
}

function updateLabels() {
  controls.segmentsValue.value = controls.segments.value;
  controls.speedValue.value = `${Number(controls.speed.value).toFixed(2)}x`;
  controls.trailValue.value = controls.trail.value;
}

function refreshSegments({ resetTime = false } = {}) {
  state.segments = buildSegments(Number(controls.segments.value));

  if (resetTime) {
    state.time = 0;
  }

  state.trail = [];
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  state.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  state.width = Math.max(320, Math.floor(rect.width));
  state.height = Math.max(320, Math.floor(rect.height));

  canvas.width = Math.floor(state.width * state.pixelRatio);
  canvas.height = Math.floor(state.height * state.pixelRatio);
  context.setTransform(state.pixelRatio, 0, 0, state.pixelRatio, 0, 0);

  refreshSegments();
}

function clearTrail() {
  state.trail = [];
}

function getChainPoints() {
  let x = state.width * 0.5;
  let y = state.height * 0.5;

  const points = [{ x, y, radius: 0 }];
  const speedMultiplier = Number(controls.speed.value);

  state.segments.forEach((segment) => {
    const angle = state.time * segment.speed * speedMultiplier + segment.phase;
    const nextX = x + Math.cos(angle) * segment.radius;
    const nextY = y + Math.sin(angle) * segment.radius;

    points.push({
      x: nextX,
      y: nextY,
      radius: segment.radius,
    });

    x = nextX;
    y = nextY;
  });

  return points;
}

function draw(points) {
  context.clearRect(0, 0, state.width, state.height);

  context.save();
  context.lineWidth = 1;
  context.strokeStyle = "rgba(130, 196, 255, 0.26)";

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];

    context.beginPath();
    context.arc(start.x, start.y, end.radius, 0, Math.PI * 2);
    context.stroke();

    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
  }

  if (state.trail.length > 1) {
    context.beginPath();
    state.trail.forEach((point, index) => {
      if (index === 0) {
        context.moveTo(point.x, point.y);
        return;
      }

      context.lineTo(point.x, point.y);
    });

    context.lineWidth = 2.5;
    context.strokeStyle = "#ffe08a";
    context.stroke();
  }

  const tip = points[points.length - 1];
  context.beginPath();
  context.fillStyle = "#6dd3ff";
  context.arc(tip.x, tip.y, 4.5, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function animate() {
  if (!state.paused) {
    state.time += 0.014;
    const points = getChainPoints();
    const tip = points[points.length - 1];

    state.trail.push({ x: tip.x, y: tip.y });

    const maxTrailLength = Number(controls.trail.value);

    if (state.trail.length > maxTrailLength) {
      state.trail.splice(0, state.trail.length - maxTrailLength);
    }

    draw(points);
  } else {
    draw(getChainPoints());
  }

  window.requestAnimationFrame(animate);
}

function togglePause() {
  state.paused = !state.paused;
  controls.pause.textContent = state.paused ? "Resume" : "Pause";
}

controls.segments.addEventListener("input", () => {
  updateLabels();
  refreshSegments({ resetTime: true });
});

controls.speed.addEventListener("input", updateLabels);

controls.trail.addEventListener("input", () => {
  updateLabels();
  state.trail = state.trail.slice(-Number(controls.trail.value));
});

controls.randomize.addEventListener("click", () => {
  refreshSegments({ resetTime: true });
});

controls.pause.addEventListener("click", togglePause);
controls.clearTrail.addEventListener("click", clearTrail);
window.addEventListener("resize", resizeCanvas);

updateLabels();
resizeCanvas();
animate();
