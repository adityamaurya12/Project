// app.js

// 1. Set your Cesium Ion Access Token
Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIwNGEyYTFhMi05OWNmLTQxNjktOTNhMi03MzA2NDI0MmE0MWUiLCJpZCI6MzQ2ODYwLCJpYXQiOjE3NTk0OTUyNTN9.uGXjX4AxNA4w3S-EuuLK7U8xQi8kLSy743cVPOHuyw8';

// 2. Global variables
let viewer;
let satRecs = []; // To store satellite records from the TLE file
let currentPosEntity = null; // The currently tracked satellite entity
let futurePathEntity = null; // The predicted path entity
let futurePosEntity = null; // The moving icon on the future path

// 3. UI Element References
const fileInput = document.getElementById('tleFileUpload');
const satSelect = document.getElementById('satelliteSelect');
const predictButton = document.getElementById('predictButton');
const predictionTimeInput = document.getElementById('predictionTime');

const latEl = document.getElementById('satLat');
const lonEl = document.getElementById('satLon');
const altEl = document.getElementById('satAlt');
const velEl = document.getElementById('satVel');

// 4. Initialization function
function initialize() {
    viewer = new Cesium.Viewer('cesiumContainer', {
        terrain: Cesium.Terrain.fromWorldTerrain(),
        infoBox: false,
        selectionIndicator: false,
        shouldAnimate: true,
    });

    // Set up event listeners for the UI controls
    fileInput.addEventListener('change', handleFileSelect);
    satSelect.addEventListener('change', trackSelectedSatellite);
    predictButton.addEventListener('click', predictAndDrawPath);
}

// 5. Event Handlers
function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const tleData = e.target.result;
        parseTleFile(tleData);
    };
    reader.readAsText(file);
}

// 6. Core Logic: Parsing and Propagation
function parseTleFile(tleData) {
    const tleLines = tleData.replace(/\r/g, '').split('\n').filter(line => line.trim() !== '');
    satRecs = [];
    try {
        for (let i = 0; i < tleLines.length; i += 2) {
            let line1, line2, name;
            if (tleLines[i].trim().startsWith('1 ')) {
                name = `Satellite ${Math.floor(i/2) + 1}`;
                line1 = tleLines[i];
                line2 = tleLines[i + 1];
            } else {
                name = tleLines[i].trim();
                line1 = tleLines[i + 1];
                line2 = tleLines[i + 2];
                i++;
            }
            const satRec = satellite.twoline2satrec(line1, line2);
            satRec.name = name;
            satRecs.push(satRec);
        }
    } catch (error) {
        alert("Error parsing TLE file. Please ensure it is correctly formatted.");
        console.error("TLE Parsing Error:", error);
        return;
    }
    populateSatelliteSelect();
}

function propagateSatellite(satrec, date) {
    const positionAndVelocity = satellite.propagate(satrec, date);
    if (!positionAndVelocity || !positionAndVelocity.position) return null;

    const positionEci = new Cesium.Cartesian3(
        positionAndVelocity.position.x * 1000,
        positionAndVelocity.position.y * 1000,
        positionAndVelocity.position.z * 1000
    );

    const icrfToFixed = Cesium.Transforms.computeIcrfToFixedMatrix(Cesium.JulianDate.fromDate(date));
    if (!icrfToFixed) return { positionEci };

    const positionEcef = Cesium.Matrix3.multiplyByVector(icrfToFixed, positionEci, new Cesium.Cartesian3());
    const cartographic = Cesium.Cartographic.fromCartesian(positionEcef);

    return {
        positionEci: positionEci,
        velocity: positionAndVelocity.velocity,
        lat: Cesium.Math.toDegrees(cartographic.latitude),
        lon: Cesium.Math.toDegrees(cartographic.longitude),
        alt: cartographic.height / 1000
    };
}

// 7. UI Update Functions
function populateSatelliteSelect() {
    satSelect.innerHTML = '<option value="" disabled selected>Select a satellite</option>';
    satRecs.forEach((rec, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = rec.name;
        satSelect.appendChild(option);
    });
    satSelect.disabled = false;
    predictionTimeInput.disabled = false;
    predictButton.disabled = false;
}

function clearEntities() {
    if (currentPosEntity) viewer.entities.remove(currentPosEntity);
    if (futurePathEntity) viewer.entities.remove(futurePathEntity);
    if (futurePosEntity) viewer.entities.remove(futurePosEntity);
    currentPosEntity = null;
    futurePathEntity = null;
    futurePosEntity = null;
}

function trackSelectedSatellite() {
    const selectedIndex = parseInt(satSelect.value, 10);
    if (isNaN(selectedIndex)) return;

    clearEntities();

    const selectedSatRec = satRecs[selectedIndex];

    currentPosEntity = viewer.entities.add({
        id: selectedSatRec.name,
        availability: new Cesium.TimeIntervalCollection([
            new Cesium.TimeInterval({ start: Cesium.JulianDate.now(), stop: Cesium.JulianDate.addDays(Cesium.JulianDate.now(), 1, new Cesium.JulianDate()) }),
        ]),
        position: new Cesium.CallbackProperty((time) => {
            const date = Cesium.JulianDate.toDate(time);
            const propagated = propagateSatellite(selectedSatRec, date);
            return propagated ? propagated.positionEci : undefined;
        }, false),
        billboard: {
            // *** CHANGED TO LOCAL FILE ***
            image: 'satellite.svg', 
            scale: 1.5,
            color: Cesium.Color.LIMEGREEN,
        },
        label: {
            text: `${selectedSatRec.name} (Current)`,
            font: '12pt monospace',
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            outlineWidth: 2,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -25),
        },
    });

    viewer.trackedEntity = currentPosEntity;
    viewer.clock.onTick.removeEventListener(updateTelemetry);
    viewer.clock.onTick.addEventListener(updateTelemetry);
}

function updateTelemetry(clock) {
    if (!currentPosEntity) return;
    const selectedIndex = parseInt(satSelect.value, 10);
    if (isNaN(selectedIndex)) return;
    const selectedSatRec = satRecs[selectedIndex];
    const date = Cesium.JulianDate.toDate(clock.currentTime);
    const propagated = propagateSatellite(selectedSatRec, date);
    if (propagated) {
        latEl.textContent = propagated.lat.toFixed(4);
        lonEl.textContent = propagated.lon.toFixed(4);
        altEl.textContent = propagated.alt.toFixed(2);
        const velocityMagnitude = Math.sqrt(
            propagated.velocity.x**2 + propagated.velocity.y**2 + propagated.velocity.z**2
        );
        velEl.textContent = velocityMagnitude.toFixed(3);
    } else {
        latEl.textContent = 'N/A';
        lonEl.textContent = 'N/A';
        altEl.textContent = 'N/A';
        velEl.textContent = 'N/A';
    }
}

function predictAndDrawPath() {
    if (futurePathEntity) viewer.entities.remove(futurePathEntity);
    if (futurePosEntity) viewer.entities.remove(futurePosEntity);

    const selectedIndex = parseInt(satSelect.value, 10);
    if (isNaN(selectedIndex)) {
        alert("Please select a satellite first.");
        return;
    }
    const selectedSatRec = satRecs[selectedIndex];
    const predictionMinutes = parseInt(predictionTimeInput.value, 10);
    const timeStepSeconds = 30;
    const numSteps = (predictionMinutes * 60) / timeStepSeconds;
    const positionProperty = new Cesium.SampledPositionProperty();
    const startTime = viewer.clock.currentTime;
    for (let i = 0; i <= numSteps; i++) {
        const time = Cesium.JulianDate.addSeconds(startTime, i * timeStepSeconds, new Cesium.JulianDate());
        const date = Cesium.JulianDate.toDate(time);
        const propagated = propagateSatellite(selectedSatRec, date);
        if (propagated) {
            positionProperty.addSample(time, propagated.positionEci);
        }
    }
    
    futurePathEntity = viewer.entities.add({
        name: `${selectedSatRec.name} Future Path`,
        availability: new Cesium.TimeIntervalCollection([
            new Cesium.TimeInterval({ start: startTime, stop: Cesium.JulianDate.addSeconds(startTime, predictionMinutes * 60, new Cesium.JulianDate()) })
        ]),
        position: positionProperty,
        path: {
            resolution: 1,
            material: new Cesium.PolylineGlowMaterialProperty({
                glowPower: 0.1,
                color: Cesium.Color.AQUAMARINE,
            }),
            width: 5,
        },
    });

    futurePosEntity = viewer.entities.add({
        name: `${selectedSatRec.name} (Future)`,
        availability: futurePathEntity.availability,
        position: positionProperty,
        billboard: {
            // *** CHANGED TO LOCAL FILE ***
            image: 'satellite.svg',
            scale: 1.5,
            color: Cesium.Color.ORANGERED,
        },
    });
}

// 8. Run the application
initialize();