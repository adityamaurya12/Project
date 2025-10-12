import numpy as np
import json
from datetime import datetime, timedelta

# Constants
mu = 398600.4418      # Earth's gravitational parameter (km^3/s^2)
J2 = 1.08263e-3       # Earth's second zonal harmonic
Re = 6378.137         # Earth's mean radius (km)
omega_earth = 7.2921150e-5 # Earth's rotation rate (rad/s)

# =========================
# 1. Read TLEs
# =========================
def read_all_tles(filename):
    tles = []
    with open(filename, "r") as f:
        lines = [line.strip() for line in f if line.strip()]
    for i in range(0, len(lines), 3):
        tles.append({
            "name": lines[i],
            "line1": lines[i+1],
            "line2": lines[i+2]
        })
    return tles

# =========================
# 2. TLE to Orbital Elements
# =========================
def tle_to_elements(line1, line2):
    epoch_year = int(line1[18:20])
    epoch_year += 2000 if epoch_year < 57 else 1900
    epoch_day = float(line1[20:32])
    epoch = datetime(epoch_year, 1, 1) + timedelta(days=epoch_day - 1)

    i = np.radians(float(line2[8:16]))
    raan = np.radians(float(line2[17:25]))
    e = float("0." + line2[26:33])
    argp = np.radians(float(line2[34:42]))
    M = np.radians(float(line2[43:51]))
    n_rev_per_day = float(line2[52:63])
    n = n_rev_per_day * 2 * np.pi / 86400.0
    a = (mu**(1/3)) / (n**(2/3))
    return a, e, i, raan, argp, M, epoch

# =========================
# 3. Kepler’s Equation
# =========================
def kepler_E(M, e, tol=1e-9):
    E = M
    dE = 1.0
    while abs(dE) > tol:
        dE = (M - (E - e * np.sin(E))) / (1 - e * np.cos(E))
        E += dE
    return E

# =========================
# 4. Convert Elements to ECI r, v
# =========================
def coe_to_rv(a, e, i, raan, argp, M):
    E = kepler_E(M, e)
    r_norm = a * (1 - e * np.cos(E))
    
    r_pqw = np.array([
        a * (np.cos(E) - e),
        a * np.sqrt(1 - e**2) * np.sin(E),
        0
    ])
    v_pqw = (np.sqrt(mu * a) / r_norm) * np.array([
        -np.sin(E),
        np.sqrt(1 - e**2) * np.cos(E),
        0
    ])

    cosO, sinO = np.cos(raan), np.sin(raan)
    cosi, sini = np.cos(i), np.sin(i)
    cosw, sinw = np.cos(argp), np.sin(argp)
    
    R = np.array([
        [cosO*cosw - sinO*sinw*cosi, -cosO*sinw - sinO*cosw*cosi, sinO*sini],
        [sinO*cosw + cosO*sinw*cosi, -sinO*sinw + cosO*cosw*cosi, -cosO*sini],
        [sinw*sini, cosw*sini, cosi]
    ])
    
    r_eci = R @ r_pqw
    v_eci = R @ v_pqw
    return r_eci, v_eci

# =========================
# 5. Acceleration with J2 Perturbation (ECI)
# =========================
def acceleration_with_J2(r_eci):
    r_norm = np.linalg.norm(r_eci)
    a_gravity = -mu * r_eci / r_norm**3
    
    z2 = r_eci[2]**2
    r2 = r_norm**2
    tx = r_eci[0]/r_norm * (5*z2/r2 - 1)
    ty = r_eci[1]/r_norm * (5*z2/r2 - 1)
    tz = r_eci[2]/r_norm * (5*z2/r2 - 3)
    
    a_J2 = (1.5 * J2 * mu * Re**2 / r_norm**4) * np.array([tx, ty, tz])
    return a_gravity + a_J2

# =========================
# 6. RK4 Propagation with J2
# =========================
def propagate_rk4_J2(r0, v0, dt):
    k1r, k1v = v0, acceleration_with_J2(r0)
    k2r, k2v = v0 + 0.5*dt*k1v, acceleration_with_J2(r0 + 0.5*dt*k1r)
    k3r, k3v = v0 + 0.5*dt*k2v, acceleration_with_J2(r0 + 0.5*dt*k2r)
    k4r, k4v = v0 + dt*k3v, acceleration_with_J2(r0 + dt*k3r)
    
    r_new = r0 + (dt/6.0) * (k1r + 2*k2r + 2*k3r + k4r)
    v_new = v0 + (dt/6.0) * (k1v + 2*k2v + 2*k3v + k4v)
    return r_new, v_new

# =========================
# 7. Coordinate Transformations
# =========================
def eci_to_ecef(r_eci, t_since_epoch):
    theta = omega_earth * t_since_epoch
    c, s = np.cos(theta), np.sin(theta)
    R = np.array([[c, s, 0], [-s, c, 0], [0, 0, 1]])
    return R @ r_eci

def ecef_to_llh(r_ecef):
    x, y, z = r_ecef
    p = np.sqrt(x**2 + y**2)
    lon = np.arctan2(y, x)
    
    # Iterative method for latitude and altitude
    lat = np.arctan2(z, p)
    e2 = 0.00669437999014
    alt = 0
    N = Re
    for _ in range(5): # 5 iterations is usually enough
        N = Re / np.sqrt(1 - e2 * np.sin(lat)**2)
        alt = p / np.cos(lat) - N
        lat = np.arctan2(z, p * (1 - e2 * N / (N + alt)))
        
    return np.degrees(lat), np.degrees(lon), alt

# =========================
# 8. MAIN
# =========================
if __name__ == "__main__":
    all_tles = read_all_tles("sate.txt")
    print("Available satellites:")
    for i, tle in enumerate(all_tles):
        print(f"  [{i+1}] {tle['name']}")
    
    choice = -1
    while choice < 1 or choice > len(all_tles):
        try:
            choice = int(input("Select a satellite by number: "))
        except ValueError:
            print("Invalid input.")

    selected_tle = all_tles[choice - 1]
    name, line1, line2 = selected_tle['name'], selected_tle['line1'], selected_tle['line2']
    print(f"\nPropagating: {name}")

    a, e, i, raan, argp, M, epoch = tle_to_elements(line1, line2)
    r0_eci, v0_eci = coe_to_rv(a, e, i, raan, argp, M)

    now_utc = datetime.utcnow()
    time_since_epoch = (now_utc - epoch).total_seconds()
    
    r_current_eci, v_current_eci = propagate_rk4_J2(r0_eci, v0_eci, time_since_epoch)
    r_current_ecef = eci_to_ecef(r_current_eci, time_since_epoch)
    lat_current, lon_current, alt_current = ecef_to_llh(r_current_ecef)
    
    while True:
        try:
            hours = float(input("Enter hours for future prediction (e.g., 6, 12.5): "))
            if hours > 0: break
            else: print("Please enter a positive number.")
        except ValueError: print("Invalid input.")

    time_step = 60
    num_steps = int(hours * 3600 / time_step)
    
    positions = []
    r_path, v_path = r_current_eci, v_current_eci
    
    for step in range(num_steps):
        t_future = step * time_step
        r_ecef = eci_to_ecef(r_path, time_since_epoch + t_future)
        lat, lon, alt = ecef_to_llh(r_ecef)
        
        pos_eci_meters = r_path * 1000
        positions.append([t_future, pos_eci_meters[0], pos_eci_meters[1], pos_eci_meters[2], lat, lon, alt])
        
        r_path, v_path = propagate_rk4_J2(r_path, v_path, time_step)
    
    output_data = {
        "name": name,
        "epoch": now_utc.isoformat() + "Z",
        "current_position_eci": (r_current_eci * 1000).tolist(),
        "current_latlonalt": [lat_current, lon_current, alt_current],
        "positions": positions
    }

    with open("satellite_data.json", "w") as f:
        json.dump(output_data, f, indent=4)

    print(f"\nSuccessfully generated path with {num_steps} points.")
    print("Saved data to satellite_data.json")

