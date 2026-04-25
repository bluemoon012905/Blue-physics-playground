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
    density: 1.2,
  },
  steel: {
    label: "Steel",
    threshold: 170,
    color: "#84b6db",
    accent: "#cfeaff",
    density: 2.1,
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
  assemblies: new Map(),
  segmentBindings: new Map(),
  freeJoints: new Map(),
  nextAssemblyId: 1,
};

const world = {
  groundRow: 15,
  gravityStep: 0.12,
  gravityForceScale: 12,
  groundBounce: 0.04,
  groundFriction: 0.05,
  airDamping: 0.996,
  angularDamping: 0.985,
  settleVelocity: 0.15,
  settleAngularVelocity: 0.003,
  maxLinearSpeed: 3.5,
  maxAngularSpeed: 0.035,
  impactForceScale: 4,
};

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

function getGroundY() {
  return grid.offsetY + world.groundRow * grid.cell;
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
  const uniqueJoints = new Map();
  state.joints.forEach((joint) => {
    uniqueJoints.set(keyForCell(joint), joint);
  });
  state.joints = [...uniqueJoints.values()];

  state.segments = state.segments.map((segment) => ({
    ...segment,
    start: uniqueJoints.get(keyForCell(segment.start)) ?? segment.start,
    end: uniqueJoints.get(keyForCell(segment.end)) ?? segment.end,
  }));
}

function toggleJoint(cell) {
  const snappedCell = findNearestSegmentEndpoint(cell) ?? cell;
  const existingIndex = state.joints.findIndex((joint) => cellsEqual(joint, snappedCell));
  if (existingIndex >= 0) {
    state.joints.splice(existingIndex, 1);
  } else {
    state.joints.push(snappedCell);
  }
  canonicalizeStructure();
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
    impactForce: 0,
  });
  canonicalizeStructure();
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
    const currentDistance = pointToSegmentDistance(point, start, end);

    if (currentDistance < bestDistance) {
      bestDistance = currentDistance;
      bestIndex = index;
      bestType = "segment";
    }
  });

  state.joints.forEach((joint, index) => {
    const currentDistance = Math.hypot(point.x - cellCenter(joint).x, point.y - cellCenter(joint).y);
    if (currentDistance < bestDistance) {
      bestDistance = currentDistance;
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

function resetDamage() {
  canonicalizeStructure();
  state.segments.forEach((segment) => {
    segment.broken = false;
    segment.force = 0;
    segment.impactForce = 0;
  });
  state.physicsActive = false;
  state.assemblies = new Map();
  state.segmentBindings = new Map();
  state.freeJoints = new Map();
  setStatus("Ready");
  analyzeForces(0);
}

function clearSegments() {
  state.segments = [];
  state.joints = [];
  state.physicsActive = false;
  state.assemblies = new Map();
  state.segmentBindings = new Map();
  state.freeJoints = new Map();
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

function getCurrentPointForNode(nodeKey) {
  if (!state.physicsActive) {
    const [x, y] = nodeKey.split(",").map(Number);
    return cellCenter({ x, y });
  }

  for (const assembly of state.assemblies.values()) {
    const local = assembly.nodeLocals.get(nodeKey);
    if (local) {
      return worldFromLocal(assembly, local);
    }
  }

  const freeJoint = state.freeJoints.get(nodeKey);
  if (freeJoint) {
    return { x: freeJoint.x, y: freeJoint.y };
  }

  const [x, y] = nodeKey.split(",").map(Number);
  return cellCenter({ x, y });
}

function buildNodeWorldMap(useCurrentState) {
  const nodeSamples = new Map();

  const addSample = (nodeKey, point) => {
    if (!nodeSamples.has(nodeKey)) {
      nodeSamples.set(nodeKey, []);
    }
    nodeSamples.get(nodeKey).push(point);
  };

  state.segments.forEach((segment) => {
    if (segment.broken && !useCurrentState) {
      return;
    }
    addSample(
      keyForCell(segment.start),
      useCurrentState ? getCurrentPointForNode(keyForCell(segment.start)) : cellCenter(segment.start),
    );
    addSample(
      keyForCell(segment.end),
      useCurrentState ? getCurrentPointForNode(keyForCell(segment.end)) : cellCenter(segment.end),
    );
  });

  state.joints.forEach((joint) => {
    addSample(
      keyForCell(joint),
      useCurrentState ? getCurrentPointForNode(keyForCell(joint)) : cellCenter(joint),
    );
  });

  const nodeWorld = new Map();
  nodeSamples.forEach((samples, key) => {
    const average = samples.reduce(
      (accumulator, point) => ({ x: accumulator.x + point.x, y: accumulator.y + point.y }),
      { x: 0, y: 0 },
    );
    nodeWorld.set(key, {
      x: average.x / samples.length,
      y: average.y / samples.length,
    });
  });

  return nodeWorld;
}

function buildSegmentAdjacency(segmentIndexes) {
  const nodeToSegments = new Map();
  segmentIndexes.forEach((index) => {
    const segment = state.segments[index];
    [segment.start, segment.end].forEach((cell) => {
      const key = keyForCell(cell);
      if (!nodeToSegments.has(key)) {
        nodeToSegments.set(key, []);
      }
      nodeToSegments.get(key).push(index);
    });
  });

  const adjacency = new Map();
  segmentIndexes.forEach((index) => adjacency.set(index, new Set()));

  nodeToSegments.forEach((indexes) => {
    indexes.forEach((index) => {
      indexes.forEach((other) => {
        if (index !== other) {
          adjacency.get(index).add(other);
        }
      });
    });
  });

  return adjacency;
}

function initializeAssemblies(useCurrentState) {
  const previousBindings = new Map(state.segmentBindings);
  const previousAssemblies = new Map(state.assemblies);
  const nodeWorld = buildNodeWorldMap(useCurrentState);
  const jointNodeKeys = new Set(state.joints.map((j) => keyForCell(j)));
  const nodeToSegments = new Map();

  state.segments.forEach((segment, index) => {
    [segment.start, segment.end].forEach((cell) => {
      const key = keyForCell(cell);
      if (!nodeToSegments.has(key)) {
        nodeToSegments.set(key, []);
      }
      if (!segment.broken) {
        nodeToSegments.get(key).push(index);
      }
    });
  });

  state.assemblies = new Map();
  state.segmentBindings = new Map();
  state.freeJoints = new Map();

  const visited = new Set();

  state.segments.forEach((segment, index) => {
    if (visited.has(index)) {
      return;
    }

    if (segment.broken) {
      visited.add(index);
      const startKey = keyForCell(segment.start);
      const endKey = keyForCell(segment.end);
      const startPoint = nodeWorld.get(startKey) ?? cellCenter(segment.start);
      const endPoint = nodeWorld.get(endKey) ?? cellCenter(segment.end);
      const centroid = {
        x: (startPoint.x + endPoint.x) * 0.5,
        y: (startPoint.y + endPoint.y) * 0.5,
      };
      const mass =
        distance(segment.start, segment.end) * materialConfig[segment.material].density;
      const nodeLocals = new Map([
        [startKey, { x: startPoint.x - centroid.x, y: startPoint.y - centroid.y }],
        [endKey, { x: endPoint.x - centroid.x, y: endPoint.y - centroid.y }],
      ]);
      const length = Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y);
      const inertia = Math.max(1, mass * (length * length) / 12);

      const previous = useCurrentState ? previousBindings.get(index) : null;
      const body = previous && previousAssemblies.has(previous.assemblyId)
        ? previousAssemblies.get(previous.assemblyId)
        : null;

      const assemblyId = state.nextAssemblyId++;
      const assembly = {
        id: assemblyId,
        x: centroid.x,
        y: centroid.y,
        vx: body?.vx ?? 0,
        vy: body?.vy ?? 0,
        angle: body?.angle ?? 0,
        omega: body?.omega ?? 0,
        mass: Math.max(1, mass),
        inertia,
        nodeLocals,
        segmentIndexes: [index],
        adjacency: new Map([[index, new Set()]]),
        jointKeys: [],
        contactSegments: [],
      };

      state.assemblies.set(assemblyId, assembly);
      state.segmentBindings.set(index, {
        assemblyId,
        startKey,
        endKey,
      });
      return;
    }

    const queue = [index];
    const segmentIndexes = [];
    const nodeKeys = new Set();

    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);
      segmentIndexes.push(current);

      const currentSegment = state.segments[current];
      [currentSegment.start, currentSegment.end].forEach((cell) => {
        const key = keyForCell(cell);
        nodeKeys.add(key);
        if (!jointNodeKeys.has(key)) {
          (nodeToSegments.get(key) ?? []).forEach((neighbor) => {
            if (!visited.has(neighbor)) {
              queue.push(neighbor);
            }
          });
        }
      });
    }

    const points = [...nodeKeys].map((key) => nodeWorld.get(key)).filter(Boolean);
    const centroid = points.reduce(
      (accumulator, point) => ({ x: accumulator.x + point.x, y: accumulator.y + point.y }),
      { x: 0, y: 0 },
    );
    centroid.x /= points.length;
    centroid.y /= points.length;

    const mass = segmentIndexes.reduce((sum, segmentIndex) => {
      const currentSegment = state.segments[segmentIndex];
      return sum + distance(currentSegment.start, currentSegment.end) * materialConfig[currentSegment.material].density;
    }, 0);

    const nodeLocals = new Map();
    [...nodeKeys].forEach((key) => {
      const point = nodeWorld.get(key);
      nodeLocals.set(key, { x: point.x - centroid.x, y: point.y - centroid.y });
    });

    let inertia = 0;
    segmentIndexes.forEach((segmentIndex) => {
      const currentSegment = state.segments[segmentIndex];
      const start = nodeWorld.get(keyForCell(currentSegment.start));
      const end = nodeWorld.get(keyForCell(currentSegment.end));
      const segmentMass =
        distance(currentSegment.start, currentSegment.end) * materialConfig[currentSegment.material].density;
      const center = { x: (start.x + end.x) * 0.5, y: (start.y + end.y) * 0.5 };
      const radiusSquared = (center.x - centroid.x) ** 2 + (center.y - centroid.y) ** 2;
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      inertia += segmentMass * ((length * length) / 12 + radiusSquared);
    });

    const assemblyId = state.nextAssemblyId++;
    const previous = useCurrentState
      ? segmentIndexes
          .map((segmentIndex) => previousBindings.get(segmentIndex))
          .find(Boolean)
      : null;

    const body = previous && previousAssemblies.has(previous.assemblyId)
      ? previousAssemblies.get(previous.assemblyId)
      : null;

    const assembly = {
      id: assemblyId,
      x: centroid.x,
      y: centroid.y,
      vx: body?.vx ?? 0,
      vy: body?.vy ?? 0,
      angle: 0,
      omega: body?.omega ?? 0,
      mass: Math.max(1, mass),
      inertia: Math.max(1, inertia),
      nodeLocals,
      segmentIndexes,
      adjacency: buildSegmentAdjacency(segmentIndexes),
      jointKeys: state.joints
        .map((joint) => keyForCell(joint))
        .filter((key) => nodeKeys.has(key)),
      contactSegments: [],
    };

    state.assemblies.set(assemblyId, assembly);
    segmentIndexes.forEach((segmentIndex) => {
      const currentSegment = state.segments[segmentIndex];
      state.segmentBindings.set(segmentIndex, {
        assemblyId,
        startKey: keyForCell(currentSegment.start),
        endKey: keyForCell(currentSegment.end),
      });
    });
  });

  state.joints.forEach((joint) => {
    const key = keyForCell(joint);
    const attached = [...state.assemblies.values()].some((assembly) => assembly.nodeLocals.has(key));
    if (attached) {
      return;
    }

    const point = nodeWorld.get(key) ?? cellCenter(joint);
    state.freeJoints.set(key, {
      x: point.x,
      y: point.y,
      vx: 0,
      vy: 0,
    });
  });
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
  initializeAssemblies(state.physicsActive);
  state.physicsActive = true;
  setStatus("Physics running");
}

function clampAssemblyMotion(assembly) {
  assembly.vx = clamp(assembly.vx, -world.maxLinearSpeed, world.maxLinearSpeed);
  assembly.vy = clamp(assembly.vy, -world.maxLinearSpeed, world.maxLinearSpeed);
  assembly.omega = clamp(assembly.omega, -world.maxAngularSpeed, world.maxAngularSpeed);
}

function worldFromLocal(assembly, local) {
  const cos = Math.cos(assembly.angle);
  const sin = Math.sin(assembly.angle);
  return {
    x: assembly.x + local.x * cos - local.y * sin,
    y: assembly.y + local.x * sin + local.y * cos,
  };
}

function velocityAtLocalPoint(assembly, local) {
  return {
    x: assembly.vx - assembly.omega * local.y,
    y: assembly.vy + assembly.omega * local.x,
  };
}

function applyImpulseAtLocalPoint(assembly, local, impulse) {
  assembly.vx += impulse.x / assembly.mass;
  assembly.vy += impulse.y / assembly.mass;
  assembly.omega += (local.x * impulse.y - local.y * impulse.x) / assembly.inertia;
  clampAssemblyMotion(assembly);
}

function getWorldPointForSegmentEndpoint(segmentIndex, endpoint) {
  const binding = state.segmentBindings.get(segmentIndex);
  if (!binding) {
    const segment = state.segments[segmentIndex];
    return cellCenter(endpoint === "start" ? segment.start : segment.end);
  }

  const assembly = state.assemblies.get(binding.assemblyId);
  if (!assembly) {
    const segment = state.segments[segmentIndex];
    return cellCenter(endpoint === "start" ? segment.start : segment.end);
  }

  const key = endpoint === "start" ? binding.startKey : binding.endKey;
  return worldFromLocal(assembly, assembly.nodeLocals.get(key));
}

function getWorldPointForJoint(joint) {
  const key = keyForCell(joint);
  const free = state.freeJoints.get(key);
  if (free) {
    return { x: free.x, y: free.y };
  }

  for (const assembly of state.assemblies.values()) {
    const local = assembly.nodeLocals.get(key);
    if (local) {
      return worldFromLocal(assembly, local);
    }
  }

  return cellCenter(joint);
}

function distributeAssemblyImpact(assembly, sourceSegmentIndex, impactMagnitude) {
  const visited = new Set([sourceSegmentIndex]);
  const queue = [{ segmentIndex: sourceSegmentIndex, depth: 0 }];

  while (queue.length > 0) {
    const { segmentIndex, depth } = queue.shift();
    const attenuation = Math.pow(0.72, depth);
    const segment = state.segments[segmentIndex];
    segment.impactForce = Math.max(segment.impactForce ?? 0, impactMagnitude * attenuation);

    (assembly.adjacency.get(segmentIndex) ?? []).forEach((neighbor) => {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ segmentIndex: neighbor, depth: depth + 1 });
      }
    });
  }
}

function solveAssemblyGroundCollisions() {
  const groundY = getGroundY();

  state.assemblies.forEach((assembly) => {
    const contacts = [];

    assembly.segmentIndexes.forEach((segmentIndex) => {
      const binding = state.segmentBindings.get(segmentIndex);
      ["start", "end"].forEach((endpoint) => {
        const key = endpoint === "start" ? binding.startKey : binding.endKey;
        const local = assembly.nodeLocals.get(key);
        const point = worldFromLocal(assembly, local);
        if (point.y > groundY) {
          contacts.push({
            segmentIndex,
            local,
            penetration: point.y - groundY,
            velocity: velocityAtLocalPoint(assembly, local),
          });
        }
      });
    });

    if (contacts.length === 0) {
      return;
    }

    const deepest = contacts.reduce((best, contact) =>
      contact.penetration > best.penetration ? contact : best,
    );

    assembly.y -= deepest.penetration;

    const fallSpeed = Math.max(0, assembly.vy);

    if (deepest.velocity.y > 0) {
      // Effective mass at the contact point for a vertical (ground-normal) impulse.
      // The ground normal is (0, -1) in screen coords (upward).
      // r × n  =  local.x * (−1) − local.y * 0  =  −local.x
      // effective_mass = 1 / (1/M + (r × n)² / I)  =  1 / (1/M + local.x² / I)
      const lx = deepest.local.x;
      const effectiveMass = 1 / (1 / assembly.mass + (lx * lx) / assembly.inertia);
      // j is the scalar impulse in the normal direction (positive = upward push).
      const j = deepest.velocity.y * (1 + world.groundBounce) * effectiveMass;
      // Apply (0, −j) impulse: reduces vy and corrects omega proportionally.
      assembly.vy -= j / assembly.mass;
      assembly.omega -= (j * lx) / assembly.inertia;

      distributeAssemblyImpact(
        assembly,
        deepest.segmentIndex,
        fallSpeed * assembly.mass * world.impactForceScale / Math.max(assembly.segmentIndexes.length, 1),
      );
    }

    clampAssemblyMotion(assembly);

    assembly.omega *= 0.88;
    if (contacts.length > 1) {
      assembly.vx *= 1 - world.groundFriction;
      assembly.omega *= 0.88;
    }

    if (Math.abs(assembly.vy) < world.settleVelocity) {
      assembly.vy = 0;
    }
    if (Math.abs(assembly.vx) < world.settleVelocity * 0.5) {
      assembly.vx = 0;
    }
    if (Math.abs(assembly.omega) < world.settleAngularVelocity) {
      assembly.omega = 0;
    }
    clampAssemblyMotion(assembly);
  });

  state.freeJoints.forEach((joint) => {
    if (joint.y <= groundY) {
      return;
    }

    joint.y = groundY;
    joint.vy *= -world.groundBounce;
    joint.vx *= 1 - world.groundFriction;
    if (Math.abs(joint.vy) < world.settleVelocity) {
      joint.vy = 0;
    }
    if (Math.abs(joint.vx) < world.settleVelocity * 0.5) {
      joint.vx = 0;
    }
  });
}

function analyzeForces(loadFactor = 1) {
  const gravityLoad = loadFactor * world.gravityForceScale;
  let maxForce = 0;
  let brokenCount = 0;
  let breakTriggered = false;

  state.segments.forEach((segment) => {
    segment.force = 0;
  });

  state.assemblies.forEach((assembly) => {
    const gravityPerSegment = (assembly.mass * gravityLoad) / Math.max(assembly.segmentIndexes.length, 1);

    assembly.segmentIndexes.forEach((segmentIndex) => {
      const segment = state.segments[segmentIndex];
      const impactForce = segment.impactForce ?? 0;
      const force = gravityPerSegment + impactForce;
      segment.force = force;
      maxForce = Math.max(maxForce, force);

      if (!segment.broken && force > materialConfig[segment.material].threshold) {
        segment.broken = true;
        breakTriggered = true;
      }
    });
  });

  brokenCount = state.segments.filter((segment) => segment.broken).length;
  state.maxForce = maxForce;
  controls.appliedLoad.textContent = `${gravityLoad.toFixed(0)} kN`;
  controls.maxForce.textContent = `${maxForce.toFixed(0)} kN`;
  controls.brokenCount.textContent = `${brokenCount}`;

  if (breakTriggered) {
    initializeAssemblies(true);
  }
}

function constrainHingePair(A, la, B, lb) {
  const posA = worldFromLocal(A, la);
  const posB = worldFromLocal(B, lb);
  const err = { x: posA.x - posB.x, y: posA.y - posB.y };
  const bias = 0.4;
  A.x -= err.x * bias * 0.5;
  A.y -= err.y * bias * 0.5;
  B.x += err.x * bias * 0.5;
  B.y += err.y * bias * 0.5;

  const velA = velocityAtLocalPoint(A, la);
  const velB = velocityAtLocalPoint(B, lb);
  const dv = { x: velA.x - velB.x, y: velA.y - velB.y };
  const Kx = 1 / A.mass + la.y * la.y / A.inertia + 1 / B.mass + lb.y * lb.y / B.inertia;
  const Ky = 1 / A.mass + la.x * la.x / A.inertia + 1 / B.mass + lb.x * lb.x / B.inertia;
  const jx = -dv.x / Kx;
  const jy = -dv.y / Ky;
  A.vx += jx / A.mass;
  A.vy += jy / A.mass;
  A.omega += (la.x * jy - la.y * jx) / A.inertia;
  B.vx -= jx / B.mass;
  B.vy -= jy / B.mass;
  B.omega -= (lb.x * jy - lb.y * jx) / B.inertia;
  clampAssemblyMotion(A);
  clampAssemblyMotion(B);
}

function solveHingeConstraints() {
  state.joints.forEach((joint) => {
    const key = keyForCell(joint);
    const attached = [];
    state.assemblies.forEach((assembly) => {
      const local = assembly.nodeLocals.get(key);
      if (local !== undefined) {
        attached.push({ assembly, local });
      }
    });
    if (attached.length < 2) {
      return;
    }
    for (let i = 0; i < attached.length - 1; i += 1) {
      for (let j = i + 1; j < attached.length; j += 1) {
        constrainHingePair(attached[i].assembly, attached[i].local, attached[j].assembly, attached[j].local);
      }
    }
  });
}

function updatePhysics() {
  if (!state.physicsActive) {
    return;
  }

  state.segments.forEach((segment) => {
    segment.impactForce = (segment.impactForce ?? 0) * 0.85;
  });

  state.assemblies.forEach((assembly) => {
    assembly.vy += world.gravityStep;
    assembly.vx *= world.airDamping;
    assembly.vy *= world.airDamping;
    assembly.omega *= world.angularDamping;
    clampAssemblyMotion(assembly);
    assembly.x += assembly.vx;
    assembly.y += assembly.vy;
    assembly.angle += assembly.omega;
  });

  state.freeJoints.forEach((joint) => {
    joint.vy += world.gravityStep;
    joint.vx *= world.airDamping;
    joint.vy *= world.airDamping;
    joint.x += joint.vx;
    joint.y += joint.vy;
  });

  solveAssemblyGroundCollisions();
  for (let i = 0; i < 5; i += 1) {
    solveHingeConstraints();
  }
  analyzeForces(1);

  let movingBodies = 0;
  state.assemblies.forEach((assembly) => {
    if (
      Math.abs(assembly.vx) > 0.02 ||
      Math.abs(assembly.vy) > 0.02 ||
      Math.abs(assembly.omega) > world.settleAngularVelocity
    ) {
      movingBodies += 1;
    }
  });
  state.freeJoints.forEach((joint) => {
    if (Math.abs(joint.vx) > 0.02 || Math.abs(joint.vy) > 0.02) {
      movingBodies += 1;
    }
  });

  if (movingBodies === 0) {
    state.physicsActive = false;
    setStatus(Number(controls.brokenCount.textContent) === 0 ? "Settled" : "Settled with breaks");
  }
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

function drawSegment(segment, index) {
  const start = getWorldPointForSegmentEndpoint(index, "start");
  const end = getWorldPointForSegmentEndpoint(index, "end");
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
  const center = getWorldPointForJoint(joint);

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
  updatePhysics();
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
