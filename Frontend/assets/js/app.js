// frontend/assets/js/app.js

// -- Configuration --
const BACKEND_API_URL = 'http://localhost:8000/api'; // Update this to your deployed FastAPI URL
const INITIAL_VIEW_LAT = 28.6139; // New Delhi Lat
const INITIAL_VIEW_LON = 77.2090; // New Delhi Lon
const INITIAL_VIEW_ALT = 10000000.0; // Zoom level in meters

// --- Global State ---
let viewer;
let trackedTles = []; // Array to hold TLE objects {name, line1, line2}
let cesiumEntities = new Map(); // Map to store Cesium Entity by satellite name
let currentEpochUtc; // The UTC time that the backend used for propagation


// --- Utility Functions ---

// Converts ECI (km) to Cesium Cartesian3 (meters)
// This is a crucial function. Backend gives ECI. Cesium expects meters.
// For correct visualization, we need to apply the rotation from ECI to ECEF
// using the time epoch.
function eciToCesiumCartesian3(r_km, time_sec, epoch_utc) {
    // Current time in JulianDate based on epoch_utc and time_sec offset
    const currentJulianDate = Cesium.JulianDate.addSeconds(
        Cesium.JulianDate.fromIso8601(epoch_utc),
        time_sec,
        new Cesium.JulianDate()
    );

    // Create an ECI position from the r_km vector
    const eciPosition = new Cesium.Cartesian3(r_km[0] * 1000, r_km[1] * 1000, r_km[2] * 1000);

    // Convert ECI to ECEF (Fixed-frame) using Cesium's built-in functionality
    // This is the most accurate way for Cesium to display it on the rotating globe
    return Cesium.Transforms.transform(
        eciPosition,
        Cesium.Matrix4.fromRotationTranslation(
            Cesium.Transforms.computeFixedToIcrfMatrix(currentJulianDate).inverse()
        )
    );
}


// --- CesiumJS Initialization ---
function initializeCesium() {
    Cesium.Ion.defaultAccessToken = '2618482685'; // !!! REPLACE WITH YOUR TOKEN !!!

    viewer = new Cesium.Viewer('cesiumContainer', {
        timeline: true,
        animation: true,
        baseLayerPicker: true,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        navigationHelpButton: false,
        fullscreenButton: false,
        sceneModePicker: false
    });

    // Set initial camera view
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(INITIAL_VIEW_LON, INITIAL_VIEW_LAT, INITIAL_VIEW_ALT),
        orientation: {
            heading: Cesium.Math.toRadians(0.0),
            pitch: Cesium.Math.toRadians(-90.0),
            roll: Cesium.Math.toRadians(0.0)
        },
        duration: 0 // Instant jump
    });

    // Add ground station marker (e.g., New Delhi)
    viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(INITIAL_VIEW_LON, INITIAL_VIEW_LAT, 0),
        point: { pixelSize: 10, color: Cesium.Color.YELLOW },
        label: { text: 'Ground Station', verticalOrigin: Cesium.VerticalOrigin.BOTTOM, font: '14px sans-serif', fillColor: Cesium.Color.WHITE, showBackground: true }
    });

    // Update UI elements based on Cesium clock
    viewer.clock.onTick.addEventListener(() => {
        document.getElementById('currentTime').innerText = Cesium.JulianDate.toDate(viewer.clock.currentTime).toUTCString();
        document.getElementById('currentSpeed').innerText = `${viewer.clock.multiplier.toFixed(0)}x`;
    });
}


// --- TLE Management ---
async function fetchDefaultTles() {
    // In a real app, you would fetch these from your backend /api/default_tles
    // For now, hardcode or fetch from a static file for the demo
    const defaultTlesResponse = await fetch('data/default_tles.json'); // Assume a JSON file
    const defaultTlesData = await defaultTlesResponse.json();
    trackedTles = defaultTlesData;
    updateTrackedSatellitesUI();
}

async function handleTleFileInput(event) {
    const files = event.target.files;
    if (files.length === 0) return;

    for (const file of files) {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const content = e.target.result;
            const parsedTles = parseTleFileContent(content); // Implement TLE parsing
            trackedTles.push(...parsedTles);
            updateTrackedSatellitesUI();
            await fetchAndRenderSatellites(); // Rerender with new TLEs
        };
        reader.readAsText(file);
    }
}

function parseTleFileContent(content) {
    const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const parsed = [];
    for (let i = 0; i < lines.length; i += 3) {
        if (lines[i+1] && lines[i+2]) {
            parsed.push({
                name: lines[i],
                line1: lines[i+1],
                line2: lines[i+2]
            });
        }
    }
    return parsed;
}

function updateTrackedSatellitesUI() {
    const listElement = document.getElementById('trackedSatellitesList');
    listElement.innerHTML = ''; // Clear existing list

    trackedTles.forEach(tle => {
        const div = document.createElement('div');
        div.className = "bg-gray-600 p-2 rounded flex items-center justify-between cursor-pointer hover:bg-gray-500";
        div.innerHTML = `<span>${tle.name}</span><span class="text-xs text-blue-400">Active</span>`;
        div.onclick = () => {
            // Focus camera on this satellite
            const entity = cesiumEntities.get(tle.name);
            if(entity) {
                viewer.flyTo(entity, { duration: 1 });
                updateSatelliteDetailsUI(tle.name); // Update right panel
            }
        };
        listElement.appendChild(div);
    });
    document.getElementById('trackedObjectsCount').innerText = trackedTles.length;
}


// --- Data Fetching & Rendering ---
async function fetchAndRenderSatellites() {
    if (trackedTles.length === 0) return;

    try {
        const response = await fetch(`${BACKEND_API_URL}/get_ephemeris`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(trackedTles)
        });
        const result = await response.json();
        
        const ephemerisData = result.ephemeris_data;
        const alerts = result.alerts;
        currentEpochUtc = result.epoch_utc; // Store the backend's epoch

        // Clear existing satellites
        cesiumEntities.forEach(entity => viewer.entities.remove(entity));
        cesiumEntities.clear();

        ephemerisData.forEach(sat => {
            const sampledPosition = new Cesium.SampledPositionProperty();
            
            sat.ephemeris.forEach(eph => {
                // Backend's epoch + time_sec = actual time for this point
                const julianDate = Cesium.JulianDate.addSeconds(
                    Cesium.JulianDate.fromIso8601(currentEpochUtc),
                    eph.time_sec,
                    new Cesium.JulianDate()
                );
                const position = eciToCesiumCartesian3(eph.r_km, eph.time_sec, currentEpochUtc);
                sampledPosition.addSample(julianDate, position);
            });

            const satelliteEntity = viewer.entities.add({
                id: sat.name,
                name: sat.name,
                position: sampledPosition,
                path: {
                    resolution: 1,
                    material: Cesium.Color.CYAN,
                    width: 2,
                    show: true // Default to showing paths
                },
                point: {
                    pixelSize: 8,
                    color: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2
                },
                label: {
                    text: sat.name,
                    font: '14px sans-serif',
                    fillColor: Cesium.Color.WHITE,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    outlineWidth: 2,
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    pixelOffset: new Cesium.Cartesian2(0, -9)
                }
            });
            cesiumEntities.set(sat.name, satelliteEntity);
        });

        // Set Cesium clock to start from the backend's epoch
        viewer.clock.startTime = Cesium.JulianDate.fromIso8601(currentEpochUtc);
        viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(currentEpochUtc);
        viewer.clock.stopTime = Cesium.JulianDate.addSeconds(viewer.clock.startTime, ephemerisData[0].ephemeris.slice(-1)[0].time_sec, new Cesium.JulianDate());
        viewer.clock.shouldAnimate = true;


        displayAlerts(alerts); // Update right panel with alerts

    } catch (error) {
        console.error("Error fetching or rendering satellites:", error);
        alert('Failed to load satellite data. Check backend or network.');
    }
}


// --- UI Update Functions ---
function displayAlerts(alerts) {
    const collisionWarningPanel = document.getElementById('collisionWarningPanel');
    const collisionPair = document.getElementById('collisionPair');
    const collisionTCA = document.getElementById('collisionTCA');
    const collisionMinDistance = document.getElementById('collisionMinDistance');

    if (alerts && alerts.length > 0) {
        collisionWarningPanel.style.display = 'block';
        const alert = alerts[0]; // Display the first alert for simplicity
        collisionPair.innerText = alert.satellite_pair;
        collisionTCA.innerText = `${Math.round(alert.time_to_closest_sec / 60)} minutes`;
        collisionMinDistance.innerText = `${alert.min_distance_km.toFixed(2)} km`;

        // Highlight affected satellites in Cesium
        const affectedSatNames = alert.satellite_pair.split(' vs ');
        affectedSatNames.forEach(name => {
            const entity = cesiumEntities.get(name.trim());
            if (entity && entity.point) {
                entity.point.color = Cesium.Color.RED;
                entity.point.pixelSize = 12;
            }
        });

    } else {
        collisionWarningPanel.style.display = 'none';
        // Reset colors for all satellites
        cesiumEntities.forEach(entity => {
            if (entity.point) {
                entity.point.color = Cesium.Color.WHITE;
                entity.point.pixelSize = 8;
            }
        });
    }
}

function updateSatelliteDetailsUI(satelliteName) {
    // This is a placeholder. In a real app, you'd fetch details
    // or use stored TLE data to populate this.
    const detailsContent = document.getElementById('satelliteDetailsContent');
    detailsContent.innerHTML = `
        <h3 class="font-bold text-gray-200">${satelliteName}</h3>
        <p class="text-blue-400 font-medium">ORBITAL ELEMENTS</p>
        <p>Semi-Major Axis: <span class="float-right font-mono">... km</span></p>
        <p>Inclination: <span class="float-right font-mono">...°</span></p>
        <p>Eccentricity: <span class="float-right font-mono">...</span></p>

        <p class="text-blue-400 font-medium mt-4">CURRENT POSITION</p>
        <p>Altitude: <span class="float-right font-mono">... km</span></p>
        <p>Speed: <span class="float-right font-mono">... km/s</span></p>
        <p>Latitude: <span class="float-right font-mono">...°</span></p>
        <p>Longitude: <span class="float-right font-mono">...°</span></p>
    `;
}


// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    initializeCesium();
    fetchDefaultTles(); // Load initial satellites
    
    // TLE File Input Handlers
    const tleFileInput = document.getElementById('tleFileInput');
    const dropArea = document.getElementById('drop-area');

    tleFileInput.addEventListener('change', handleTleFileInput);
    
    dropArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropArea.classList.add('border-blue-500', 'text-blue-400');
    });
    dropArea.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropArea.classList.remove('border-blue-500', 'text-blue-400');
    });
    dropArea.addEventListener('drop', (e) => {
        e.preventDefault();
        dropArea.classList.remove('border-blue-500', 'text-blue-400');
        tleFileInput.files = e.dataTransfer.files;
        handleTleFileInput({ target: tleFileInput });
    });

    // Periodically refresh data (e.g., every 5 minutes for alerts)
    setInterval(fetchAndRenderSatellites, 300 * 1000); // 5 minutes
});