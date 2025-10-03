 Orbital Tracker: 3D Satellite Tracking System
This is an advanced web application designed to track Low Earth Orbit (LEO) satellites in near real-time, visualizing their orbital parameters, close-approach warnings, and pass predictions within a comprehensive 3D environment.

The unique strength of this project lies in its use of a custom orbital propagator based on the Universal Variable formulation, offering high accuracy independent of standard library dependencies.

✨ Key Features
Custom Propagator: Uses a bespoke Universal Variable Propagator for accurate Keplerian orbit prediction, offering robust performance compared to simplified models like SGP4.

3D Visualization: Employs CesiumJS to render a high-fidelity, Google Earth-like 3D globe and interactive satellite paths.

Real-time Collision Alert: Predicts and displays High-Priority Warnings for potential close-approaches between all tracked satellite pairs in the near future.

Dynamic TLE Input: Users can upload any TLE file to track their own satellite and compare its orbit with pre-loaded or currently tracked LEO objects.

Astrodynamics Core: Handles complex coordinate transformations between ECI, ECEF, and Geodetic systems.

🛠️ Technology Stack
Component	Technology	Description
Backend / API	Python, FastAPI	A fast, modern API framework for serving astrodynamic calculations, propagation, and alert data in JSON format.
Astrodynamics	NumPy	Used for vector mathematics and the execution of the custom propagation and coordinate transformation algorithms.
Frontend / 3D	CesiumJS	The core library for rendering the production-grade 3D globe and managing satellite entities and animation.
Styling / UI	HTML5, Tailwind CSS	Used for building a clean, responsive, dark-themed user interface and control panels.

Export to Sheets
⚙️ Setup and Installation
To get the project running, you must set up both the Backend (API) and the Frontend (Web UI).

File	Purpose and Core Functionality
main.py	API Entry Point & Routing. Initializes the FastAPI application. Defines the API endpoints (/api/get_ephemeris, /api/check_collision) and orchestrates the calls to the propagation and alerts modules.
propagation.py	Orbital Mechanics Engine. Contains the core logic: tle_to_elements, coe_to_rv, kepler_E, stumpC, stumpS, and the crucial propagate_universal function for state vector calculation.
utils.py	Coordinate System Toolkit. Handles time-dependent and geometric transformations: gmst_rad (Greenwich Mean Sidereal Time calculation), eci_to_ecef (transforming the propagated position to the Earth-fixed frame), and ecef_to_lat_lon_alt (for ground-based calculations).
alerts.py	Prediction and Warning Logic. Implements check_close_approach to iterate through satellite pairs and determine minimum separation distance (collision check). Will also include check_pass for ground station visibility prediction.
requirements.txt	Dependencies. Lists all required Python packages (fastapi, numpy, uvicorn, requests) necessary for the backend to function correctly.

2. Frontend Setup (CesiumJS)
The Frontend is a static HTML/JS application.

Navigate to the Frontend Folder:

Bash

cd ../frontend
Update Cesium Ion Token:

Open the file frontend/assets/js/app.js.

Replace the placeholder value for Cesium.Ion.defaultAccessToken with your personal Cesium Ion access token.

Open the Website:

Open frontend/index.html in your web browser (or use a tool like the VS Code "Live Server" extension for easier development).

The frontend will automatically attempt to connect to the FastAPI endpoint at http://localhost:8000.

📝 Technical Details of the Core
The project’s strength lies in its mathematical core, implemented in Python:

A. Orbital Mechanics Implementation
Propagation Core (propagation.py): The propagate_universal function is the heart of the system. It calculates the satellite's future position using a highly iterative method to solve for the Universal Variable, χ.

Stumpff Functions: The stumpC and stumpS functions are crucial for handling various orbit types (elliptical, parabolic, and hyperbolic) within a single, unified mathematical framework, ensuring numerical stability.

B. Coordinate System Handling
utils.py contains functions to handle the crucial shift from the ECI (Earth-Centered Inertial) frame (where propagation naturally occurs) to the ECEF (Earth-Centered, Earth-Fixed) frame, which rotates with the Earth. This rotation is essential for plotting the satellite correctly on the 3D globe and for accurate Pass Prediction and Collision Alert geometry.

C. Alert Logic
The Collision Alert (check_close_approach) iterates through the future ephemerides of all satellite pairs and calculates the Euclidean distance between them. If the distance falls below a set threshold (e.g., 10 km), a warning is generated with the Time of Closest Approach (TCA).

