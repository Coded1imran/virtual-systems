// --- RUNTIME STATE VALUES CONTROL ---
let currentAngle = 0;
let telemetryAngle = document.getElementById('telemetry-angle');
let telemetryMode = document.getElementById('telemetry-mode');
const telemetry = {
    leftMotor: document.getElementById('telemetry-left'),
    rightMotor: document.getElementById('telemetry-right'),
    pitch: document.getElementById('telemetry-pitch'),
    roll: document.getElementById('telemetry-roll'),
    height: document.getElementById('telemetry-height'),
    source: document.getElementById('telemetry-source'),
    buttons: new Set(),
    sticks: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
    lastUpdate: performance.now(),
    unityFields: new Set(),
    pitchValue: 0,
    rollValue: 0,
    heightValue: 0
};

// The exact GameObject string name containing your script component inside the Unity hierarchy
const UNITY_TARGET_OBJECT = "DroneBridge";

function sendUnityMessage(method, value) {
    if (windowUnityInstance === null) return;
    if (value === undefined) {
        windowUnityInstance.SendMessage(UNITY_TARGET_OBJECT, method);
    } else {
        windowUnityInstance.SendMessage(UNITY_TARGET_OBJECT, method, value);
    }
}

function setUnityButton(command, active) {
    if (active) telemetry.buttons.add(command);
    else telemetry.buttons.delete(command);
    sendUnityMessage("SetButton", command + "," + (active ? "1" : "0"));
}

function updateTelemetry() {
    const now = performance.now();
    const delta = Math.min((now - telemetry.lastUpdate) / 1000, 0.1);
    telemetry.lastUpdate = now;

    const pressed = command => telemetry.buttons.has(command);
    const clamp = value => Math.max(-1, Math.min(1, value));
    const throttle = clamp(Number(pressed("FORWARD")) - Number(pressed("BACK")));
    const turn = clamp(
        Number(pressed("TURN_RIGHT")) - Number(pressed("TURN_LEFT")) +
        telemetry.sticks[0].x
    );
    const maxRpm = Number(document.getElementById('param-speed').value) || 100;
    const targetLeft = Math.round(maxRpm * clamp(throttle - turn));
    const targetRight = Math.round(maxRpm * clamp(throttle + turn));
    const smoothing = 1 - Math.exp(-10 * delta);
    if (!telemetry.unityFields.has('leftMotor')) {
        telemetry.leftRpm += (targetLeft - telemetry.leftRpm) * smoothing;
        telemetry.leftMotor.textContent = `${Math.round(telemetry.leftRpm)} RPM`;
    }
    if (!telemetry.unityFields.has('rightMotor')) {
        telemetry.rightRpm += (targetRight - telemetry.rightRpm) * smoothing;
        telemetry.rightMotor.textContent = `${Math.round(telemetry.rightRpm)} RPM`;
    }
    if (!telemetry.unityFields.has('heading')) {
        currentAngle = (currentAngle + turn * 90 * delta + 360) % 360;
        telemetryAngle.textContent = `${Math.round(currentAngle)}°`;
    }
    const pitchTarget = clamp(telemetry.sticks[1].y * 24 +
        (Number(pressed("FORWARD")) - Number(pressed("BACK"))) * 18);
    const rollTarget = clamp(telemetry.sticks[1].x * 24);
    const orientationSmoothing = 1 - Math.exp(-7 * delta);
    if (!telemetry.unityFields.has('pitch')) {
        telemetry.pitchValue += (pitchTarget - telemetry.pitchValue) * orientationSmoothing;
        telemetry.pitch.textContent = `${telemetry.pitchValue.toFixed(1)}° (est.)`;
    }
    if (!telemetry.unityFields.has('roll')) {
        telemetry.rollValue += (rollTarget - telemetry.rollValue) * orientationSmoothing;
        telemetry.roll.textContent = `${telemetry.rollValue.toFixed(1)}° (est.)`;
    }
    if (!telemetry.unityFields.has('height')) {
        const climb = telemetry.sticks[0].y;
        const verticalSpeed = climb > 0.05 ? climb * 1.5 :
            climb < -0.05 ? climb * 1.5 : -0.5;
        telemetry.heightValue = Math.max(0, telemetry.heightValue + verticalSpeed * delta);
        telemetry.height.textContent = `${telemetry.heightValue.toFixed(2)} m (est.)`;
    }
    const orientationSource = ['pitch', 'roll', 'heading'].every(field => telemetry.unityFields.has(field))
        ? 'Unity orientation'
        : 'Estimated orientation';
    const heightSource = telemetry.unityFields.has('height') ? 'Unity height' : 'estimated height';
    const motorSource = telemetry.unityFields.has('leftMotor') && telemetry.unityFields.has('rightMotor')
        ? 'Unity motors'
        : 'estimated motors';
    telemetry.source.textContent = `${orientationSource}; ${heightSource}; ${motorSource}`;
}

telemetry.leftRpm = 0;
telemetry.rightRpm = 0;
setInterval(updateTelemetry, 50);

window.onUnityTelemetry = json => {
    const payload = typeof json === "string" ? json : JSON.stringify(json);
    let values = {};
    try {
        values = JSON.parse(payload);
    } catch (error) {
        // Read valid numeric fields even if another field in Unity's payload is malformed.
    }

    const readNumber = key => {
        const parsed = values[key];
        const value = typeof parsed === "number" ? parsed :
            typeof parsed === "string" && parsed.trim() !== "" ? Number(parsed) : NaN;
        if (Number.isFinite(value)) return value;
        const match = payload.match(new RegExp(`["']?${key}["']?\\s*:\\s*(-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?)`));
        return match ? Number(match[1]) : null;
    };
    const updateValue = (key, element, value, format) => {
        if (value === null || !Number.isFinite(value)) return;
        telemetry.unityFields.add(key);
        element.textContent = format(value);
    };

    updateValue('leftMotor', telemetry.leftMotor, readNumber('leftMotor'), value => `${Math.round(value)} RPM`);
    updateValue('rightMotor', telemetry.rightMotor, readNumber('rightMotor'), value => `${Math.round(value)} RPM`);
    updateValue('pitch', telemetry.pitch, readNumber('pitch'), value => `${value.toFixed(1)}°`);
    updateValue('roll', telemetry.roll, readNumber('roll'), value => `${value.toFixed(1)}°`);
    updateValue('height', telemetry.height, readNumber('height'), value => `${value.toFixed(2)} m`);
    const heading = readNumber('heading');
    if (heading !== null) {
        telemetry.unityFields.add('heading');
        currentAngle = ((heading % 360) + 360) % 360;
        telemetryAngle.textContent = `${Math.round(currentAngle)}°`;
    }

    const mode = values.mode || (payload.match(/["']?mode["']?\s*:\s*["']([^"']+)["']/) || [])[1];
    if (mode) telemetryMode.textContent = mode;
};

function moveForward() {
    setUnityButton("FORWARD", true);
    clearTimeout(moveForward.releaseTimer);
    moveForward.releaseTimer = setTimeout(() => setUnityButton("FORWARD", false), 250);
}

function turnLeft() {
    setUnityButton("TURN_LEFT", true);
    clearTimeout(turnLeft.releaseTimer);
    turnLeft.releaseTimer = setTimeout(() => setUnityButton("TURN_LEFT", false), 250);
}

function turnRight() {
    setUnityButton("TURN_RIGHT", true);
    clearTimeout(turnRight.releaseTimer);
    turnRight.releaseTimer = setTimeout(() => setUnityButton("TURN_RIGHT", false), 250);
}

function resetRobot() {
    currentAngle = 0;
    telemetry.leftRpm = 0;
    telemetry.rightRpm = 0;
    telemetry.pitchValue = 0;
    telemetry.rollValue = 0;
    telemetry.heightValue = 0;
    telemetry.unityFields.clear();
    telemetry.pitch.textContent = "0.0° (est.)";
    telemetry.roll.textContent = "0.0° (est.)";
    telemetry.height.textContent = "0.00 m (est.)";
    telemetry.source.textContent = "Estimated from controls";
    telemetryAngle.innerText = `${currentAngle}°`;
    sendUnityMessage("ResetDrone");
}

function executeBackAction() {
    setUnityButton("BACK", true);
    clearTimeout(executeBackAction.releaseTimer);
    executeBackAction.releaseTimer = setTimeout(() => setUnityButton("BACK", false), 250);
}

function setKnobMode(position) {
    const knob = document.getElementById('behavior-knob');
    const labels = document.querySelectorAll('.k-label');
    knob.className = `knob position-${position}`;
    labels.forEach(l => l.classList.remove('active'));
    labels[position - 1].classList.add('active');

    let modeText = "MANUAL";
    if (position === 1) telemetryMode.innerText = "MANUAL TELEOP";
    else if (position === 2) { telemetryMode.innerText = "MAZE AUTO"; modeText = "MAZE"; }
    else if (position === 3) { telemetryMode.innerText = "LINE PID"; modeText = "LINE"; }

    sendUnityMessage("SetMode", modeText);
}

function updatePhysicalParams() {
    let rpm = Number(document.getElementById('param-speed').value);
    let weight = Number(document.getElementById('param-weight').value);
    document.getElementById('weight-val').innerText = `${weight} kg`;

    if (windowUnityInstance !== null) {
        windowUnityInstance.SendMessage(UNITY_TARGET_OBJECT, "UpdateMaxSpeed", rpm);
        windowUnityInstance.SendMessage(UNITY_TARGET_OBJECT, "UpdateMass", weight);
    }
}

function toggleTheme() {
    const body = document.body;
    const btn = document.getElementById('theme-toggle');
    if (body.getAttribute('data-theme') === 'dark') {
        body.setAttribute('data-theme', 'light');
        btn.innerText = "Dark Mode";
    } else {
        body.setAttribute('data-theme', 'dark');
        btn.innerText = "Light Mode";
    }
}

// --- DUAL THUMBSTICK CONTINUOUS TRACKING DRIVERS ---
function setupJoystick(boundaryId, stickId, stickNumber) {
    const boundary = document.getElementById(boundaryId);
    const stick = document.getElementById(stickId);
    let activeDrag = false;
    let centerPt = 45;

    boundary.addEventListener('pointerdown', (event) => {
        activeDrag = true;
        boundary.setPointerCapture(event.pointerId);
        event.preventDefault();
    });
    const releaseStick = () => {
        if (!activeDrag) return;
        activeDrag = false;
        stick.style.left = 'calc(50% - 16px)';
        stick.style.top = 'calc(50% - 16px)';
        telemetry.sticks[stickNumber - 1] = { x: 0, y: 0 };
        const method = stickNumber === 1 ? "SetStick1" : "SetStick2";
        sendUnityMessage(method, "0,0");
    };
    document.addEventListener('pointerup', releaseStick);
    document.addEventListener('pointercancel', releaseStick);

    document.addEventListener('pointermove', (e) => {
        if (!activeDrag) return;
        const rect = boundary.getBoundingClientRect();
        let currentX = e.clientX - rect.left - centerPt;
        let currentY = e.clientY - rect.top - centerPt;
        const maxRadius = 30;
        const dist = Math.sqrt(currentX*currentX + currentY*currentY);

        if (dist > maxRadius) {
            currentX = (currentX / dist) * maxRadius;
            currentY = (currentY / dist) * maxRadius;
        }

        stick.style.left = `${centerPt + currentX - 16}px`;
        stick.style.top = `${centerPt + currentY - 16}px`;
        let normX = currentX / maxRadius;
        let normY = -(currentY / maxRadius);
        telemetry.sticks[stickNumber - 1] = { x: normX, y: normY };

        const method = stickNumber === 1 ? "SetStick1" : "SetStick2";
        sendUnityMessage(method, `${normX},${normY}`);
    });
}

// Instantiate side-by-side stick track configurations
setupJoystick('joy-boundary-1', 'joy-stick-1', 1);
setupJoystick('joy-boundary-2', 'joy-stick-2', 2);