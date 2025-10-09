import numpy as np
from flask import Flask, jsonify, request, render_template
from datetime import datetime, timedelta
import math

# --- CONSTANTS ---
mu = 398600.4418  # Earth's Gravitational Parameter (km^3/s^2)
RE = 6378.137    # Earth's Equatorial Radius (km)

# --- FLASK APP SETUP ---
# 🟢 CRITICAL FIX 1: Configure Flask for the backend/frontend structure.
app = Flask(
    __name__, 
    template_folder='../frontend', 
    static_folder='../frontend/assets'
)

# In-memory storage for tracked TLEs
SATELLITES = {
    # NOTE: I've corrected the TLE epoch time in the example data for consistency.
    "25544": {
        "name": "ISS (ZARYA)",
        "type": "Observatory",
        "tle_line1": "1 25544U 98067A   25278.50000000  .00000000  00000-0  10000-3 0  9999",
        "tle_line2": "2 25544  51.6413 220.4000 0007421  89.4600 270.5400 15.49479155400000",
        "epoch_time": datetime(2025, 10, 5, 0, 0, 0).isoformat(), 
        "last_r": None,
        "last_v": None
    },
    "44422": {
        "name": "STARLINK-5001",
        "type": "Communication",
        "tle_line1": "1 44422U 19074A   25278.50000000  .00000000  00000-0  50000-4 0  9999",
        "tle_line2": "2 44422  53.0000 150.0000 0003000  90.0000 270.0000 15.00000000000000",
        "epoch_time": datetime(2025, 10, 5, 0, 0, 0).isoformat(), 
        "last_r": None,
        "last_v": None
    }
}

# ----------------------------------------------------------------------
# --- ORBITAL MECHANICS FUNCTIONS (PASTED BACK IN) ---
# ----------------------------------------------------------------------

def parse_tle_epoch(tle_line1):
    """Parses the year and day from TLE line 1 to get a datetime object."""
    try:
        year_code = int(tle_line1[18:20].strip())
        day_of_year = float(tle_line1[20:32].strip())
        full_year = 2000 + year_code if year_code >= 57 else 2000 + year_code
        epoch_date = datetime(full_year, 1, 1) + timedelta(days=day_of_year - 1)
        return epoch_date
    except Exception as e:
        return datetime.utcnow()

def tle_to_elements(line2):
    """Parses TLE line 2 and calculates Initial Orbital Elements (FIXED)."""
    i = float(line2[8:16]) * np.pi/180.0
    raan = float(line2[17:25]) * np.pi/180.0
    e = float("0." + line2[26:33])
    argp = float(line2[34:42]) * np.pi/180.0
    M = float(line2[43:51]) * np.pi/180.0
    n = float(line2[52:63]) # rev/day
    
    n_rad_s = n * 2*np.pi / 86400.0 # rad/s
    
    # CRITICAL FIX: Correct formula for semi-major axis (a) from n
    a = (mu / (n_rad_s**2))**(1/3) 
    
    return a, e, i, raan, argp, M

def kepler_E(M, e, tol=1e-8):
    """Solves Kepler's equation for Eccentric Anomaly (E)."""
    E = M
    for _ in range(100):
        dE = (M - (E - e*np.sin(E))) / (1 - e*np.cos(E))
        E += dE
        if abs(dE) < tol:
            break
    return E

def coe_to_rv(a, e, i, raan, argp, M):
    """Converts Classical Orbital Elements (COE) to State Vectors (r, v) (FIXED)."""
    E = kepler_E(M, e)
    
    r_norm = a * (1 - e * np.cos(E)) 
    
    r_pf = np.array([a*(np.cos(E)-e), a*np.sqrt(1-e**2)*np.sin(E), 0.0])
    
    # CRITICAL FIX: Correct velocity magnitude factor
    v_factor = np.sqrt(mu / a) / (1 - e * np.cos(E))
    v_pf = np.array([-np.sin(E), np.sqrt(1-e**2)*np.cos(E), 0.0]) * v_factor

    cosO, sinO = np.cos(raan), np.sin(raan)
    cosi, sini = np.cos(i), np.sin(i)
    cosw, sinw = np.cos(argp), np.sin(argp)
    
    R3_O = np.array([[cosO, -sinO, 0],[sinO, cosO, 0],[0,0,1]])
    R1_i = np.array([[1,0,0],[0, cosi, -sini],[0, sini, cosi]])
    R3_w = np.array([[cosw, -sinw, 0],[sinw, cosw, 0],[0,0,1]])
    
    Q = R3_O @ R1_i @ R3_w
    
    r = Q @ r_pf
    v = Q @ v_pf
    
    return r, v 

def stumpC(z):
    if z > 0: return (1-np.cos(np.sqrt(z)))/z
    if z < 0: return (np.cosh(np.sqrt(-z))-1)/(-z)
    return 0.5

def stumpS(z):
    if z > 0: return (np.sqrt(z)-np.sin(np.sqrt(z)))/(np.sqrt(z)**3)
    if z < 0: return (np.sinh(np.sqrt(-z))-np.sqrt(-z))/(np.sqrt(-z)**3)
    return 1/6

def propagate_universal(r0, v0, dt):
    """Universal Variable Kepler's Problem Solver (FIXED)."""
    r0n = np.linalg.norm(r0)
    v0n = np.linalg.norm(v0)
    alpha = 2/r0n - v0n**2/mu
    
    # Initialize chi
    chi = np.sqrt(mu) * np.abs(alpha) * dt 
    if alpha > 0:
        chi = np.sqrt(mu) * dt / r0n
    elif alpha < 0:
        chi = np.sqrt(mu) * dt / np.abs(alpha)
    else:
        chi = np.sqrt(mu) * dt / r0n 

    for _ in range(1000):
        z = alpha*chi**2
        C = stumpC(z)
        S = stumpS(z)
        
        r_mag = chi**2*C + (np.dot(r0,v0)/np.sqrt(mu))*chi*(1 - z*S) + r0n*(1 - z*C)
        F = r_mag - np.sqrt(mu) * dt
        
        # CRITICAL FIX: Complete formula for derivative dF/dchi
        dF = (np.dot(r0,v0)/np.sqrt(mu))*chi*(1 - z*S) + (1 - alpha*r0n)*chi**2*C
        
        dchi = -F/dF
        chi += dchi
        
        if abs(dchi) < 1e-8: break

    # Final calculate f, g, r_vec, v_vec
    z = alpha*chi**2
    f = 1 - chi**2*C/r0n
    g = dt - chi**3*S/np.sqrt(mu)
    r_vec = f*r0 + g*v0
    
    rnorm = np.linalg.norm(r_vec)
    fdot = (np.sqrt(mu)/(rnorm*r0n))*(z*S - 1)*chi
    gdot = 1 - chi**2*C/rnorm
    v_vec = fdot*r0 + gdot*v0
    
    return r_vec, v_vec

def position_to_lla(r):
    """Converts ECI position vector (r) to Latitude, Longitude, Altitude (LLA)."""
    r_norm = np.linalg.norm(r)
    altitude = r_norm - RE
    
    # Calculate Lat/Lon assuming simple ECI (ignores Greenwich Time/Earth Rotation)
    lat = np.arcsin(r[2] / r_norm) * 180 / np.pi
    # Lon requires knowledge of Greenwich Mean Sidereal Time, but for a 
    # simplified ECI plot, we use a basic angle:
    lon = np.arctan2(r[1], r[0]) * 180 / np.pi
    
    return lat, lon, altitude

# ----------------------------------------------------------------------
# --- API ENDPOINTS ---
# ----------------------------------------------------------------------

@app.route('/')
def serve_index():
    """Serves the main tracking page (index.html)."""
    return render_template('index.html')

@app.route('/database')
def serve_database():
    """Serves the satellite database page (database.html)."""
    return render_template('database.html')


@app.route('/api/track', methods=['POST'])
def track_satellite():
    """Handles TLE upload and initialization."""
    data = request.json
    tle_data = data.get('tleData')
    
    if not tle_data:
        return jsonify({"status": "error", "message": "No TLE data provided."}), 400

    lines = [line.strip() for line in tle_data.split('\n') if line.strip()]
    if len(lines) != 3:
        return jsonify({"status": "error", "message": "TLE must have 3 lines (Name, Line 1, Line 2)."}), 400

    name, l1, l2 = lines[0], lines[1], lines[2]
    norad_id = l1[2:7].strip()

    try:
        epoch_dt = parse_tle_epoch(l1)

        # Ensure elements can be calculated before storing
        a, e, i, raan, argp, M = tle_to_elements(l2)
        r0, v0 = coe_to_rv(a, e, i, raan, argp, M)
        
        SATELLITES[norad_id] = {
            "name": name,
            "type": "Custom",
            "tle_line1": l1,
            "tle_line2": l2,
            "epoch_time": epoch_dt.isoformat(), 
            "last_r": r0.tolist(),
            "last_v": v0.tolist()
        }

        return jsonify({"status": "success", "message": f"'{name}' tracked successfully.", "noradId": norad_id})
    except Exception as e:
        # Return a 500 status code for server-side calculation errors
        return jsonify({"status": "error", "message": f"Calculation error: {str(e)}"}), 500


@app.route('/api/positions', methods=['GET'])
def get_current_positions():
    """Calculates and returns the current position, velocity, and details for all tracked satellites."""
    response_data = []
    current_time = datetime.utcnow()
    
    for norad_id, sat_data in SATELLITES.items():
        try:
            epoch_dt = datetime.fromisoformat(sat_data['epoch_time'])
            # Calculate time elapsed since TLE epoch
            dt = (current_time - epoch_dt).total_seconds()
            
            # --- PROPAGATE ---
            a, e, i, raan, argp, M = tle_to_elements(sat_data['tle_line2'])
            r0, v0 = coe_to_rv(a, e, i, raan, argp, M)
            
            r, v = propagate_universal(r0, v0, dt)
            lat, lon, alt = position_to_lla(r)
            speed = np.linalg.norm(v)

            response_data.append({
                "noradId": norad_id,
                "name": sat_data['name'],
                "type": sat_data['type'],
                "altitude_km": f"{alt:.2f}",
                "speed_km_s": f"{speed:.2f}",
                "status": "Active",
                "r_eci": r.tolist(),
                "v_eci": v.tolist(),
                "latitude": lat,
                "longitude": lon,
            })
        except Exception as e:
            # Handle propagation errors gracefully without crashing the whole API
            response_data.append({
                "noradId": norad_id,
                "name": sat_data['name'],
                "status": "Propagation Error",
                "error": str(e)
            })

    return jsonify(response_data)

if __name__ == '__main__':
    app.run(debug=True, port=5000)