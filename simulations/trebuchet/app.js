const canvas = document.getElementById("trebuchet-canvas");
const context = canvas.getContext("2d");

const controls = {
  launch: document.getElementById("launch"),
  reset: document.getElementById("reset"),
  clearLayout: document.getElementById("clear-layout"),
  status: document.getElementById("status-label"),
  appliedLoad: document.getElementById("applied-load-value"),
  maxForce: document.getElementById("max-force-value"),
  brokenCount: document.getElementById("broken-count-value"),
  selectedToolLabel: document.getElementById("selected-tool-label"),
  toolButtons: [...document.querySelectorAll("[data-tool]")],
};

const grid = {
  cols: 28,
  rows: 18,
  cell: 0,
  offsetX: 0,
  offsetY: 0,
  pivotCell: { x: 7, y: 6 },
};

const materialConfig = {
  wood: {
    label: "Wood",
    threshold: 85,
    color: "#d29b62",
    accent: "#f5c589",
  },
  steel: {
    label: "Steel",
    threshold: 170,
    color: "#84b6db",
    accent: "#cfeaff",
  },
};

const toolConfig = {
  wood: "Wood Beam",
  steel: "Steel Beam",
  joint: "Joint",
  erase: "Eraser",
};

const state = {
  pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
  width: 0,
  height: 0,
  selectedTool: "wood",
  hoveredCell: null,
  dragStart: null,
  dragPreview: null,
  segments: [],
  joints: [],
  terrain: [],
  maxForce: 0,
  physicsActive: false,
  bodyStates: new Map(),
  jointStates: new Map(),
};

const world = {
  metersPerCell: 1.25,
  groundRow: 15,
  groundBounce: 0.05,
  groundFriction: 0.04,
  settleVelocity: 0.12,
  settleAngularVelocity: 0.001,
  gravityStep: 0.12,
  gravityForceScale: 18,
  impactForceScale: 1.4,
  airDamping: 0.996,
  angularDamping: 0.988,
  jointIterations: 12,
  maxLinearSpeed: 4,
  maxAngularSpeed: 0.045,
};

function degToRad(value) {
  return (value * Math.PI) / 180;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function keyForCell(cell) {
  return `${cell.x},${cell.y}`;
}

function cellsEqual(a, b) {
  return a && b && a.x === b.x && a.y === b.y;
}

function cellCenter(cell) {
  return {
    x: grid.offsetX + cell.x * grid.cell + grid.cell * 0.5,
    y: grid.offsetY + cell.y * grid.cell + grid.cell * 0.5,
  };
}

function updateLabels() {
  controls.selectedToolLabel.textContent = `Tool: ${toolConfig[state.selectedTool]}`;
}

function setStatus(text) {
  controls.status.textContent = text;
}

function setTool(tool) {
  state.selectedTool = tool;
  controls.toolButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tool === tool);
  });
  updateLabels();
}

function buildTerrain() {
  state.terrain = Array.from({ length: grid.cols }, () => world.groundRow);
}

function getCellFromPointer(event) {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const gridX = Math.round((x - grid.offsetX - grid.cell * 0.5) / grid.cell);
  const gridY = Math.round((y - grid.offsetY - grid.cell * 0.5) / grid.cell);

  if (gridX < 0 || gridX >= grid.cols || gridY < 0 || gridY >= grid.rows) {
    return null;
  }

  return { x: gridX, y: gridY };
}

function segmentLengthCells(segment) {
  return distance(segment.start, segment.end);
}

function findNearestJoint(cell, maxDistance = 1.25) {
  let bestJoint = null;
  let bestDistance = Infinity;

  state.joints.forEach((joint) => {
    const currentDistance = distance(cell, joint);
    if (currentDistance <= maxDistance && currentDistance < bestDistance) {
      bestDistance = currentDistance;
      bestJoint = joint;
    }
  });

  return bestJoint;
}

function findNearestSegmentEndpoint(cell, maxDistance = 1.25) {
  let bestCell = null;
  let bestDistance = Infinity;

  state.segments.forEach((segment) => {
    [segment.start, segment.end].forEach((endpoint) => {
      const currentDistance = distance(cell, endpoint);
      if (currentDistance <= maxDistance && currentDistance < bestDistance) {
        bestDistance = currentDistance;
        bestCell = endpoint;
      }
    });
  });

  return bestCell;
}

function snapCell(cell) {
  return findNearestJoint(cell) ?? findNearestSegmentEndpoint(cell) ?? cell;
}

function canonicalizeStructure() {
  const canonicalJointMap = new Map();
  const dedupedJoints = [];

  state.joints.forEach((joint) => {
    const key = keyForCell(joint);
    if (!canonicalJointMap.has(key)) {
      canonicalJointMap.set(key, joint);
      dedupedJoints.push(joint);
    }
  });

  state.joints = dedupedJoints;

  state.segments = state.segments.map((segment) => {
    const startJoint = canonicalJointMap.get(keyForCell(segment.start));
    const endJoint = canonicalJointMap.get(keyForCell(segment.end));

    return {
      ...segment,
      start: startJoint ?? segment.start,
      end: endJoint ?? segment.end,
    };
  });
}

function toggleJoint(cell) {
  const snappedCell = findNearestSegmentEndpoint(cell) ?? cell;
  const existingIndex = state.joints.findIndex((joint) => cellsEqual(joint, snappedCell));
  if (existingIndex >= 0) {
    state.joints.splice(existingIndex, 1);
    return;
  }

  state.joints.push(snappedCell);
  canonicalizeStructure();
}

function analyzeForces(loadFactor = 1) {
  const gravityLoad = loadFactor * world.gravityForceScale;

  let maxForce = 0;
  let brokenCount = state.segments.filter((segment) => segment.broken).length;

  state.segments.forEach((segment, index) => {
    if (segment.broken) {
      segment.force = 0;
      return;
    }

    const body = state.bodyStates.get(index);
    const angle = body ? body.angle : Math.atan2(segment.end.y - segment.start.y, segment.end.x - segment.start.x);
    const lengthFactor = 1 + segmentLengthCells(segment) * 0.1;
    const orientationFactor = 0.85 + Math.abs(Math.cos(angle)) * 0.2;
    const gravityForce = gravityLoad * lengthFactor * orientationFactor;
    const impactForce = segment.impactForce ?? 0;
    const force = gravityForce + impactForce;

    segment.force = force;
    maxForce = Math.max(maxForce, force);

    const threshold = materialConfig[segment.material].threshold;
    if (force > threshold) {
      segment.broken = true;
      brokenCount += 1;
    }
  });

  state.maxForce = maxForce;
  controls.appliedLoad.textContent = `${gravityLoad.toFixed(0)} kN`;
  controls.maxForce.textContent = `${maxForce.toFixed(0)} kN`;
  controls.brokenCount.textContent = `${brokenCount}`;
}

function initializePhysicsBodies() {
  state.bodyStates = new Map();
  state.jointStates = new Map();

  state.segments.forEach((segment, index) => {
    const start = cellCenter(segment.start);
    const end = cellCenter(segment.end);
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const density = segment.material === "steel" ? 2.1 : 1.2;
    const mass = Math.max(1, segmentLengthCells(segment) * density);

    state.bodyStates.set(index, {
      x: (start.x + end.x) * 0.5,
      y: (start.y + end.y) * 0.5,
      vx: 0,
      vy: 0,
      angle: Math.atan2(end.y - start.y, end.x - start.x),
      omega: 0,
      length,
      mass,
      inertia: Math.max(1, (mass * length * length) / 12),
    });

    segment.impactForce = 0;
  });

  state.joints.forEach((joint) => {
    const point = cellCenter(joint);
    const attachments = [];

    state.segments.forEach((segment, index) => {
      if (segment.broken) {
        return;
      }
      if (cellsEqual(segment.start, joint)) {
        attachments.push({ segmentIndex: index, endpoint: "start" });
      }
      if (cellsEqual(segment.end, joint)) {
        attachments.push({ segmentIndex: index, endpoint: "end" });
      }
    });

    state.jointStates.set(keyForCell(joint), {
      joint,
      x: point.x,
      y: point.y,
      vx: 0,
      vy: 0,
      anchored: joint.y >= world.groundRow,
      attachments,
    });
  });
}

function addSegment(start, end, material) {
  const snappedStart = snapCell(start);
  const snappedEnd = snapCell(end);

  if (cellsEqual(snappedStart, snappedEnd)) {
    return;
  }

  state.segments.push({
    start: snappedStart,
    end: snappedEnd,
    material,
    broken: false,
    force: 0,
  });

  canonicalizeStructure();
}

function removeNearestSegment(cell) {
  if (state.segments.length === 0 && state.joints.length === 0) {
    return;
  }

  const point = cellCenter(cell);
  let bestIndex = -1;
  let bestDistance = Infinity;
  let bestType = "segment";

  state.segments.forEach((segment, index) => {
    const start = cellCenter(segment.start);
    const end = cellCenter(segment.end);
    const distanceToSegment = pointToSegmentDistance(point, start, end);

    if (distanceToSegment < bestDistance) {
      bestDistance = distanceToSegment;
      bestIndex = index;
      bestType = "segment";
    }
  });

  state.joints.forEach((joint, index) => {
    const jointPoint = cellCenter(joint);
    const jointDistance = Math.hypot(point.x - jointPoint.x, point.y - jointPoint.y);
    if (jointDistance < bestDistance) {
      bestDistance = jointDistance;
      bestIndex = index;
      bestType = "joint";
    }
  });

  if (bestIndex >= 0 && bestDistance <= grid.cell * 0.7) {
    if (bestType === "segment") {
      state.segments.splice(bestIndex, 1);
    } else {
      state.joints.splice(bestIndex, 1);
    }
    canonicalizeStructure();
  }
}

function pointToSegmentDistance(point, start, end) {
  const lengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = clamp(
    ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) /
      lengthSquared,
    0,
    1,
  );

  const projection = {
    x: start.x + t * (end.x - start.x),
    y: start.y + t * (end.y - start.y),
  };

  return Math.hypot(point.x - projection.x, point.y - projection.y);
}

function resetDamage() {
  canonicalizeStructure();
  state.segments.forEach((segment) => {
    segment.broken = false;
    segment.force = 0;
    segment.impactForce = 0;
  });
  state.physicsActive = false;
  state.bodyStates = new Map();
  state.jointStates = new Map();
  setStatus("Ready");
  analyzeForces(0);
}

function clearSegments() {
  state.segments = [];
  state.joints = [];
  state.physicsActive = false;
  state.bodyStates = new Map();
  state.jointStates = new Map();
  setStatus("Ready");
  analyzeForces(0);
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  state.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  state.width = Math.floor(rect.width);
  state.height = Math.floor(rect.height);

  canvas.width = Math.floor(state.width * state.pixelRatio);
  canvas.height = Math.floor(state.height * state.pixelRatio);
  context.setTransform(state.pixelRatio, 0, 0, state.pixelRatio, 0, 0);

  grid.cell = Math.floor(Math.min(state.width / grid.cols, state.height / grid.rows));
  grid.offsetX = Math.floor((state.width - grid.cols * grid.cell) * 0.5);
  grid.offsetY = Math.floor((state.height - grid.rows * grid.cell) * 0.5);

  buildTerrain();
  analyzeForces(0);
}

function launch() {
  if (state.segments.length === 0 && state.joints.length === 0) {
    setStatus("Draw something first");
    return;
  }

  canonicalizeStructure();
  state.segments.forEach((segment) => {
    segment.broken = false;
    segment.force = 0;
    segment.impactForce = 0;
  });
  initializePhysicsBodies();
  state.physicsActive = true;
  setStatus("Physics running");
}

function updateLaunch() {
  if (!state.physicsActive) {
    return;
  }
  const gravityStep = world.gravityStep;

  state.segments.forEach((segment) => {
    segment.impactForce = (segment.impactForce ?? 0) * 0.9;
  });

  state.bodyStates.forEach((body, index) => {
    body.vy += gravityStep;
    body.vx *= world.airDamping;
    body.vy *= world.airDamping;
    body.omega *= world.angularDamping;
    clampBodyMotion(body);
    body.x += body.vx;
    body.y += body.vy;
    body.angle += body.omega;
  });

  state.jointStates.forEach((joint) => {
    if (joint.anchored) {
      return;
    }
    joint.vy += gravityStep;
    joint.vx *= world.airDamping;
    joint.vy *= world.airDamping;
    joint.x += joint.vx;
    joint.y += joint.vy;
  });

  for (let iteration = 0; iteration < world.jointIterations; iteration += 1) {
    solveJointConstraints();
    solveGroundCollisions();
  }
  solveJointConstraints();

  analyzeForces(1);

  let movingBodies = 0;
  state.bodyStates.forEach((body, index) => {
    if (state.segments[index].broken) {
      movingBodies += Math.abs(body.vx) + Math.abs(body.vy) + Math.abs(body.omega) > 0.02 ? 1 : 0;
      return;
    }
    if (Math.abs(body.vx) > 0.02 || Math.abs(body.vy) > 0.02 || Math.abs(body.omega) > world.settleAngularVelocity) {
      movingBodies += 1;
    }
  });
  state.jointStates.forEach((joint) => {
    if (!joint.anchored && (Math.abs(joint.vx) > 0.02 || Math.abs(joint.vy) > 0.02)) {
      movingBodies += 1;
    }
  });

  if (movingBodies === 0) {
    state.physicsActive = false;
    setStatus(Number(controls.brokenCount.textContent) === 0 ? "Settled" : "Settled with breaks");
  }
}

function getBodyLocalPoint(body, endpoint) {
  return {
    x: endpoint === "start" ? -body.length * 0.5 : body.length * 0.5,
    y: 0,
  };
}

function getBodyPoint(body, endpoint) {
  const local = getBodyLocalPoint(body, endpoint);
  const cos = Math.cos(body.angle);
  const sin = Math.sin(body.angle);
  return {
    x: body.x + local.x * cos - local.y * sin,
    y: body.y + local.x * sin + local.y * cos,
  };
}

function getBodyPointVelocity(body, endpoint) {
  const local = getBodyLocalPoint(body, endpoint);
  const cos = Math.cos(body.angle);
  const sin = Math.sin(body.angle);
  const worldOffset = {
    x: local.x * cos - local.y * sin,
    y: local.x * sin + local.y * cos,
  };
  return {
    x: body.vx - body.omega * worldOffset.y,
    y: body.vy + body.omega * worldOffset.x,
  };
}

function applyBodyPointCorrection(body, endpoint, correction, strength = 1) {
  applyBodyPointCorrectionWithMode(body, endpoint, correction, strength, true);
}

function applyBodyPointCorrectionWithMode(body, endpoint, correction, strength = 1, allowRotation = true) {
  const local = getBodyLocalPoint(body, endpoint);
  body.x += correction.x * 0.5 * strength;
  body.y += correction.y * 0.5 * strength;
  if (allowRotation) {
    const torque = (local.x * correction.y - local.y * correction.x) / Math.max(body.inertia, 1);
    body.angle += torque * 0.12 * strength;
  }
}

function applyBodyPointVelocityDelta(body, endpoint, delta) {
  const local = getBodyLocalPoint(body, endpoint);
  body.vx += delta.x * 0.2;
  body.vy += delta.y * 0.2;
  const impulseTorque = (local.x * delta.y - local.y * delta.x) / Math.max(body.inertia, 1);
  body.omega += impulseTorque * 1.1;
  clampBodyMotion(body);
}

function applyBodyPointVelocityMatch(body, endpoint, targetVelocity, strength = 0.12) {
  const current = getBodyPointVelocity(body, endpoint);
  applyBodyPointVelocityDelta(body, endpoint, {
    x: (targetVelocity.x - current.x) * strength,
    y: (targetVelocity.y - current.y) * strength,
  });
}

function clampBodyMotion(body) {
  body.vx = clamp(body.vx, -world.maxLinearSpeed, world.maxLinearSpeed);
  body.vy = clamp(body.vy, -world.maxLinearSpeed, world.maxLinearSpeed);
  body.omega = clamp(body.omega, -world.maxAngularSpeed, world.maxAngularSpeed);
}

function solveJointConstraints() {
  state.jointStates.forEach((jointState) => {
    const attachments = jointState.attachments.filter(
      ({ segmentIndex }) => !state.segments[segmentIndex].broken,
    );

    if (attachments.length === 0) {
      return;
    }

    const points = attachments.map(({ segmentIndex, endpoint }) =>
      getBodyPoint(state.bodyStates.get(segmentIndex), endpoint),
    );

    const averagePoint = {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    };

    const target = jointState.anchored
      ? cellCenter(jointState.joint)
      : averagePoint;

    if (!jointState.anchored) {
      jointState.x = target.x;
      jointState.y = target.y;

      const averageVelocity = attachments.reduce(
        (accumulator, { segmentIndex, endpoint }) => {
          const velocity = getBodyPointVelocity(state.bodyStates.get(segmentIndex), endpoint);
          return {
            x: accumulator.x + velocity.x,
            y: accumulator.y + velocity.y,
          };
        },
        { x: 0, y: 0 },
      );

      jointState.vx = averageVelocity.x / attachments.length;
      jointState.vy = averageVelocity.y / attachments.length;
    } else {
      jointState.x = target.x;
      jointState.y = target.y;
      jointState.vx = 0;
      jointState.vy = 0;
    }

    attachments.forEach(({ segmentIndex, endpoint }) => {
      const body = state.bodyStates.get(segmentIndex);
      const point = getBodyPoint(body, endpoint);
      const correction = {
        x: target.x - point.x,
        y: target.y - point.y,
      };
      applyBodyPointCorrection(body, endpoint, correction, jointState.anchored ? 1 : 1);
      applyBodyPointVelocityMatch(
        body,
        endpoint,
        jointState.anchored
          ? { x: 0, y: 0 }
          : { x: jointState.vx, y: jointState.vy },
        jointState.anchored ? 0.08 : 0.16,
      );
    });
  });
}

function solveGroundCollisions() {
  const groundY = getGroundY();

  state.bodyStates.forEach((body, index) => {
    const segment = state.segments[index];
    const contacts = ["start", "end"]
      .map((endpoint) => {
        const point = getBodyPoint(body, endpoint);
        return {
          endpoint,
          point,
          penetration: point.y - groundY,
          velocity: getBodyPointVelocity(body, endpoint),
        };
      })
      .filter((contact) => contact.penetration > 0);

    if (contacts.length === 0) {
      return;
    }

    const deepest = contacts.reduce((best, contact) =>
      contact.penetration > best.penetration ? contact : best,
    );

    applyBodyPointCorrectionWithMode(
      body,
      deepest.endpoint,
      { x: 0, y: -deepest.penetration },
      1,
      false,
    );

    if (deepest.velocity.y > 0) {
      const nextVelocity = {
        x: deepest.velocity.x * (1 - world.groundFriction),
        y: -deepest.velocity.y * world.groundBounce,
      };
      applyBodyPointVelocityDelta(body, deepest.endpoint, {
        x: nextVelocity.x - deepest.velocity.x,
        y: nextVelocity.y - deepest.velocity.y,
      });
      segment.impactForce = Math.max(
        segment.impactForce ?? 0,
        body.mass * Math.abs(deepest.velocity.y) * world.impactForceScale,
      );
    }

    if (contacts.length === 2) {
      body.omega *= 0.92;
      body.vx *= 1 - world.groundFriction;
    }

    if (Math.abs(body.vy) < world.settleVelocity) {
      body.vy = 0;
    }
    if (Math.abs(body.omega) < world.settleAngularVelocity) {
      body.omega = 0;
    }
    clampBodyMotion(body);
  });

  state.jointStates.forEach((jointState) => {
    if (jointState.y <= groundY) {
      return;
    }

    jointState.y = groundY;
    jointState.vy *= -world.groundBounce;
    jointState.vx *= 1 - world.groundFriction;
    if (Math.abs(jointState.vy) < world.settleVelocity) {
      jointState.vy = 0;
    }
  });
}

function drawGrid() {
  context.save();
  context.strokeStyle = "rgba(148, 191, 232, 0.12)";
  context.lineWidth = 1;

  for (let column = 0; column <= grid.cols; column += 1) {
    const x = grid.offsetX + column * grid.cell;
    context.beginPath();
    context.moveTo(x, grid.offsetY);
    context.lineTo(x, grid.offsetY + grid.rows * grid.cell);
    context.stroke();
  }

  for (let row = 0; row <= grid.rows; row += 1) {
    const y = grid.offsetY + row * grid.cell;
    context.beginPath();
    context.moveTo(grid.offsetX, y);
    context.lineTo(grid.offsetX + grid.cols * grid.cell, y);
    context.stroke();
  }

  context.restore();
}

function drawTerrain() {
  const groundY = getGroundY();

  context.save();
  context.fillStyle = "rgba(17, 60, 86, 0.92)";
  context.strokeStyle = "rgba(112, 202, 255, 0.32)";
  context.lineWidth = 1.4;

  context.beginPath();
  context.moveTo(grid.offsetX, grid.offsetY + grid.rows * grid.cell);
  context.lineTo(grid.offsetX, groundY);
  context.lineTo(grid.offsetX + grid.cols * grid.cell, groundY);
  context.lineTo(grid.offsetX + grid.cols * grid.cell, grid.offsetY + grid.rows * grid.cell);
  context.closePath();
  context.fill();
  context.stroke();
  context.restore();
}

function getGroundY() {
  return grid.offsetY + world.groundRow * grid.cell;
}

function drawSegment(segment, index) {
  const start = getRenderedPoint(segment.start, index);
  const end = getRenderedPoint(segment.end, index);
  const material = materialConfig[segment.material];
  const ratio = clamp(segment.force / material.threshold, 0, 1.3);

  context.save();
  context.lineCap = "round";
  context.strokeStyle = segment.broken ? "#ff6b6b" : material.color;
  context.lineWidth = Math.max(4, grid.cell * 0.18);
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();

  context.fillStyle = segment.broken ? "#ffb0b0" : material.accent;
  [start, end].forEach((point) => {
    context.beginPath();
    context.arc(point.x, point.y, grid.cell * 0.12, 0, Math.PI * 2);
    context.fill();
  });

  if (!segment.broken && segment.force > 0) {
    const midX = (start.x + end.x) * 0.5;
    const midY = (start.y + end.y) * 0.5;
    context.fillStyle = ratio > 0.92 ? "#ffe08a" : "rgba(235, 246, 255, 0.88)";
    context.font = `${Math.max(10, grid.cell * 0.28)}px "Avenir Next", sans-serif`;
    context.textAlign = "center";
    context.fillText(`${segment.force.toFixed(0)}`, midX, midY - 8);
  }

  context.restore();
}

function drawJoint(joint) {
  const center = getRenderedJointPoint(joint);

  context.save();
  context.strokeStyle = "rgba(126, 240, 197, 0.95)";
  context.fillStyle = "rgba(126, 240, 197, 0.18)";
  context.lineWidth = 2;
  context.beginPath();
  context.arc(center.x, center.y, grid.cell * 0.18, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.restore();
}

function getRenderedJointPoint(joint) {
  if (state.physicsActive) {
    const jointState = state.jointStates.get(keyForCell(joint));
    if (jointState) {
      return { x: jointState.x, y: jointState.y };
    }
  }
  return cellCenter(joint);
}

function getRenderedPoint(cell, bodyIndex) {
  const point = cellCenter(cell);
  if (!state.physicsActive || bodyIndex === undefined || bodyIndex === null) {
    return point;
  }

  const body = state.bodyStates.get(bodyIndex);
  const segment = state.segments[bodyIndex];
  if (!body || !segment) {
    return point;
  }

  const endpoint = cellsEqual(segment.start, cell) ? "start" : "end";
  return getBodyPoint(body, endpoint);
}

function drawPreview() {
  if (
    !state.dragStart ||
    !state.dragPreview ||
    state.selectedTool === "erase" ||
    state.selectedTool === "joint"
  ) {
    return;
  }

  const start = cellCenter(state.dragStart);
  const end = cellCenter(state.dragPreview);
  const material = materialConfig[state.selectedTool];

  context.save();
  context.setLineDash([8, 8]);
  context.lineWidth = Math.max(3, grid.cell * 0.12);
  context.strokeStyle = material.accent;
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  context.restore();
}

function drawHover() {
  if (!state.hoveredCell) {
    return;
  }

  const center = cellCenter(state.hoveredCell);
  context.save();
  context.fillStyle = "rgba(109, 211, 255, 0.2)";
  context.beginPath();
  context.arc(center.x, center.y, grid.cell * 0.12, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawPivotMarker() {
  const pivot = cellCenter(grid.pivotCell);

  context.save();
  context.strokeStyle = "rgba(109, 211, 255, 0.45)";
  context.fillStyle = "rgba(109, 211, 255, 0.1)";
  context.lineWidth = 2;
  context.beginPath();
  context.arc(pivot.x, pivot.y, grid.cell * 0.26, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.restore();
}

function drawScene() {
  context.clearRect(0, 0, state.width, state.height);
  drawTerrain();
  drawGrid();
  state.segments.forEach((segment, index) => drawSegment(segment, index));
  state.joints.forEach(drawJoint);
  drawPreview();
  drawHover();
  drawPivotMarker();
}

function tick() {
  updateLaunch();
  drawScene();
  window.requestAnimationFrame(tick);
}

canvas.addEventListener("pointerdown", (event) => {
  const cell = getCellFromPointer(event);
  if (!cell) {
    return;
  }

  if (state.selectedTool === "erase") {
    removeNearestSegment(cell);
    analyzeForces(0);
    return;
  }

  if (state.selectedTool === "joint") {
    toggleJoint(cell);
    analyzeForces(0);
    return;
  }

  state.dragStart = cell;
  state.dragPreview = cell;
});

canvas.addEventListener("pointermove", (event) => {
  const cell = getCellFromPointer(event);
  state.hoveredCell = cell;

  if (state.dragStart && cell) {
    state.dragPreview = cell;
  }
});

canvas.addEventListener("pointerup", (event) => {
  const cell = getCellFromPointer(event);

  if (state.dragStart && cell && state.selectedTool !== "erase") {
    addSegment(state.dragStart, cell, state.selectedTool);
    analyzeForces(0);
  }

  state.dragStart = null;
  state.dragPreview = null;
});

canvas.addEventListener("pointerleave", () => {
  state.hoveredCell = null;
  state.dragPreview = state.dragStart;
});

controls.toolButtons.forEach((button) => {
  button.addEventListener("click", () => setTool(button.dataset.tool));
});

controls.launch.addEventListener("click", launch);
controls.reset.addEventListener("click", resetDamage);
controls.clearLayout.addEventListener("click", clearSegments);

window.addEventListener("resize", resizeCanvas);

updateLabels();
resizeCanvas();
tick();
